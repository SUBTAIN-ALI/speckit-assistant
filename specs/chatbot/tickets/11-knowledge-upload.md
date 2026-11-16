# Ticket 11: Knowledge Upload + Extraction

**Priority:** P1  
**Depends On:** Ticket 03  
**Requirements Ref:** Sections 4.1, 4.5  
**Estimated Effort:** Medium  

## Description

Allow users to submit domain knowledge via:
1. **Typed text** — directly in the chat ("Remember that refunds need manager approval")
2. **Document upload** — PDF, DOCX, Markdown, or TXT files

Uploaded documents are not automatically treated as verified knowledge. The content is extracted, the user reviews a proposed topic-knowledge conversion, and only approved content is saved. The chatbot reads the uploaded file, summarizes/organizes the relevant information, and proposes topic-based knowledge entries.

This ticket covers extraction and the API for uploads. The approval UI is Ticket 10.

## Files to Create

### `src/chatbot/adapters/DocumentExtractor.ts`

Extracts text from uploaded files:

```typescript
export type SupportedFormat = 'pdf' | 'docx' | 'md' | 'txt';

export interface DocumentExtractor {
  extract(filePath: string, format: SupportedFormat): Promise<string>;
  detectFormat(filename: string): SupportedFormat | null;
}
```

- **PDF**: Use the host's existing capabilities or `pdf-parse` library
- **DOCX**: Reuse `OfficeDocumentReader` (already exists at `src/adapters/secondary/docs/OfficeDocumentReader.ts`)
- **Markdown**: Read as plain text
- **TXT**: Read as plain text

### `src/chatbot/api/knowledgeHandlers.ts`

```typescript
export function createKnowledgeHandlers(knowledgeStore: KnowledgeStore, extractor: DocumentExtractor) {
  return {
    // POST /api/chatbot/knowledge/upload
    async upload(file: File, projectPath: string): Promise<{ extractedText: string }>,
    
    // POST /api/chatbot/knowledge/prepare
    async prepare(body: { slug: string; title: string; content: string }, projectPath: string): Promise<KnowledgeChange>,
    
    // POST /api/chatbot/knowledge/save
    async save(body: { slug: string; title: string; content: string }, projectPath: string): Promise<void>,
    
    // GET /api/chatbot/knowledge
    async list(projectPath: string): Promise<KnowledgeTopic[]>,
    
    // DELETE /api/chatbot/knowledge/:slug
    async delete(slug: string, projectPath: string): Promise<void>,
  };
}
```

### API Routes

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/chatbot/knowledge/upload` | Upload a document, return extracted text |
| POST | `/api/chatbot/knowledge/prepare` | Prepare a knowledge change preview |
| POST | `/api/chatbot/knowledge/save` | Save approved knowledge |
| GET | `/api/chatbot/knowledge` | List all knowledge topics |
| DELETE | `/api/chatbot/knowledge/[slug]` | Delete a topic |

### Upload Flow

1. User uploads a file (via drag-and-drop or file picker in the chat input area)
2. File sent to `/api/chatbot/knowledge/upload` as multipart form data
3. Server extracts text, returns it to the client
4. Client sends extracted text to the chatbot agent with a prompt: "Organize the following document content into domain knowledge topics: [extracted text]"
5. Agent proposes one or more `KnowledgeChange` entries
6. Each proposed entry goes through the approval modal (Ticket 10)

## Implementation Notes

- Uploaded files are NOT retained permanently. They are processed, text is extracted, and the temporary file is deleted. Only the approved topic knowledge is saved. (The doc says this decision is "not yet finalized" — we default to discard after extraction.)
- File size limit: 10MB maximum per upload
- The `DocumentExtractor` can reuse the host's `OfficeDocumentReader` via an adapter that wraps it without importing the host class directly. Or, implement extraction independently within the chatbot module.
- For DOCX: the existing `OfficeDocumentReader` already handles this — consider exposing it through `ChatbotHostPort` as `extractDocument(path, format)`.

## Acceptance Criteria

- [ ] Users can upload PDF, DOCX, MD, TXT files
- [ ] Text extracted from uploaded documents
- [ ] Extracted text not auto-saved as knowledge (AC-08)
- [ ] Upload triggers agent-based organization into topic proposals
- [ ] Each topic proposal goes through approval workflow
- [ ] Temporary uploaded files cleaned up after extraction
- [ ] File size validation (max 10MB)
- [ ] Unsupported formats rejected with clear error message

## Test Cases

### `src/chatbot/adapters/__tests__/DocumentExtractor.test.ts`

```typescript
describe('DocumentExtractor', () => {
  // T11-1: Detect format from filename
  it('detects PDF format', () => {
    expect(extractor.detectFormat('policy.pdf')).toBe('pdf');
  });
  it('detects DOCX format', () => {
    expect(extractor.detectFormat('rules.docx')).toBe('docx');
  });
  it('detects Markdown format', () => {
    expect(extractor.detectFormat('notes.md')).toBe('md');
  });
  it('detects TXT format', () => {
    expect(extractor.detectFormat('readme.txt')).toBe('txt');
  });
  it('returns null for unsupported format', () => {
    expect(extractor.detectFormat('image.png')).toBeNull();
  });

  // T11-2: Extract text from TXT
  it('extracts text from TXT file', async () => {
    const tmpFile = path.join(tmpDir, 'test.txt');
    await fs.writeFile(tmpFile, 'Plain text content');
    const text = await extractor.extract(tmpFile, 'txt');
    expect(text).toBe('Plain text content');
  });

  // T11-3: Extract text from Markdown
  it('extracts text from Markdown file', async () => {
    const tmpFile = path.join(tmpDir, 'test.md');
    await fs.writeFile(tmpFile, '# Title\n\nBody text');
    const text = await extractor.extract(tmpFile, 'md');
    expect(text).toContain('# Title');
    expect(text).toContain('Body text');
  });

  // T11-4: Reject file over 10MB
  it('rejects files over 10MB', async () => {
    const tmpFile = path.join(tmpDir, 'large.txt');
    await fs.writeFile(tmpFile, Buffer.alloc(11 * 1024 * 1024));
    await expect(extractor.extract(tmpFile, 'txt')).rejects.toThrow(/size/i);
  });
});
```

### `src/chatbot/api/__tests__/knowledgeHandlers.test.ts`

```typescript
describe('Knowledge Handlers', () => {
  // T11-5: Prepare returns KnowledgeChange
  it('prepare returns change preview without saving', async () => {
    const handlers = createKnowledgeHandlers(mockStore, mockExtractor);
    const change = await handlers.prepare(
      { slug: 'policy', title: 'Policy', content: 'New rule' },
      '/test'
    );
    expect(change.proposedContent).toBe('New rule');
    expect(mockStore.save).not.toHaveBeenCalled();
  });

  // T11-6: Save persists topic
  it('save writes to knowledge store', async () => {
    const handlers = createKnowledgeHandlers(mockStore, mockExtractor);
    await handlers.save({ slug: 'policy', title: 'Policy', content: 'Approved rule' }, '/test');
    expect(mockStore.save).toHaveBeenCalledWith('/test', expect.objectContaining({
      slug: 'policy',
      content: 'Approved rule',
    }));
  });

  // T11-7: List returns all topics
  it('list returns topics from store', async () => {
    mockStore.list.mockResolvedValue([{ slug: 'a', title: 'A', content: '', updatedAt: '' }]);
    const handlers = createKnowledgeHandlers(mockStore, mockExtractor);
    const topics = await handlers.list('/test');
    expect(topics).toHaveLength(1);
  });

  // T11-8: Delete removes topic
  it('delete calls store.delete', async () => {
    const handlers = createKnowledgeHandlers(mockStore, mockExtractor);
    await handlers.delete('policy', '/test');
    expect(mockStore.delete).toHaveBeenCalledWith('/test', 'policy');
  });
});
```
