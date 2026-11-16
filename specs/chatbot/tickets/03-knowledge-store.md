# Ticket 03: Knowledge Store — Topic-Based CRUD

**Priority:** P0  
**Depends On:** Ticket 01  
**Requirements Ref:** Sections 4.1, 4.2, 4.3, 4.4, 4.5  
**Estimated Effort:** Medium  

## Description

Implement file-based storage for user-approved domain knowledge. Knowledge is stored as individual Markdown files in `.specify/chatbot/knowledge/`, organized by topic. Each file represents one topic (e.g., "refund-policy.md", "payment-flow.md").

Knowledge is **never** auto-created. It is only saved after explicit user approval through the approval workflow (Ticket 10). This store provides the CRUD layer; the approval UI comes later.

## Files to Create

### `src/chatbot/domain/KnowledgeStore.ts`

```typescript
import { KnowledgeTopic, KnowledgeChange } from './models';

export interface KnowledgeStore {
  // List all saved knowledge topics for a project
  list(projectPath: string): Promise<KnowledgeTopic[]>;
  
  // Get a single topic by slug (returns null if not found)
  get(projectPath: string, slug: string): Promise<KnowledgeTopic | null>;
  
  // Prepare a change preview (does NOT save — just computes the diff)
  prepareChange(projectPath: string, slug: string, title: string, proposedContent: string): Promise<KnowledgeChange>;
  
  // Save a topic ONLY after user approval. Creates or overwrites the file.
  save(projectPath: string, topic: KnowledgeTopic): Promise<void>;
  
  // Delete a topic
  delete(projectPath: string, slug: string): Promise<void>;
  
  // Check if destination file changed since the change was prepared
  hasChanged(projectPath: string, slug: string, expectedContent: string | null): Promise<boolean>;
}
```

### `src/chatbot/adapters/FSKnowledgeStore.ts`

- Storage path: `<projectPath>/.specify/chatbot/knowledge/<slug>.md`
- Files are plain Markdown with a YAML frontmatter header:

```markdown
---
title: Refund Policy
updatedAt: 2026-11-16T10:30:00Z
---

Refunds are processed within 14 business days. The customer must provide...
```

- `list()` reads the directory, parses frontmatter + body for each `.md` file
- `get()` reads one file by slug
- `prepareChange()` reads existing content (if any), compares with proposed, returns a `KnowledgeChange` with `isConflict` flag
- `save()` writes the file with frontmatter — caller must have user approval first
- `hasChanged()` reads current content and compares to `expectedContent` (detects concurrent edits)
- Slugs are filename-safe: lowercase, hyphens, no special chars. Validate on save.
- Directory created on first write if missing

## Implementation Notes

- Use a simple frontmatter parser (regex or small function — don't add a dependency for this)
- `isConflict` in `prepareChange()`: true when `previousContent` exists AND `proposedContent` differs from it in a way that would remove existing unrelated text. Simple heuristic: if the proposed content doesn't contain all paragraphs from the previous content, flag it as conflict.
- For now, a simple "previous !== proposed" check for conflict is fine; the UI (Ticket 12) will show the diff and let the user decide.

## Acceptance Criteria

- [ ] `KnowledgeStore` interface defined
- [ ] `FSKnowledgeStore` reads/writes Markdown files with YAML frontmatter
- [ ] Knowledge stored in `.specify/chatbot/knowledge/`
- [ ] `prepareChange()` returns diff preview without writing
- [ ] `hasChanged()` detects concurrent modifications
- [ ] Slug validation prevents path traversal or invalid filenames
- [ ] No auto-creation of knowledge — only explicit `save()` after approval

## Test Cases

### `src/chatbot/adapters/__tests__/FSKnowledgeStore.test.ts`

```typescript
import { FSKnowledgeStore } from '../FSKnowledgeStore';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('FSKnowledgeStore', () => {
  let tmpDir: string;
  let store: FSKnowledgeStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-test-'));
    store = new FSKnowledgeStore();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // T03-1: Save and retrieve a topic
  it('saves a topic and retrieves it by slug', async () => {
    await store.save(tmpDir, {
      slug: 'refund-policy',
      title: 'Refund Policy',
      content: 'Refunds are processed within 14 days.',
      updatedAt: new Date().toISOString(),
    });
    const topic = await store.get(tmpDir, 'refund-policy');
    expect(topic).not.toBeNull();
    expect(topic!.title).toBe('Refund Policy');
    expect(topic!.content).toBe('Refunds are processed within 14 days.');
  });

  // T03-2: File written as Markdown with frontmatter
  it('writes Markdown file with YAML frontmatter', async () => {
    await store.save(tmpDir, {
      slug: 'auth-rules',
      title: 'Authentication Rules',
      content: 'All API calls require a bearer token.',
      updatedAt: '2026-11-16T10:00:00Z',
    });
    const filePath = path.join(tmpDir, '.specify', 'chatbot', 'knowledge', 'auth-rules.md');
    const raw = await fs.readFile(filePath, 'utf-8');
    expect(raw).toContain('---');
    expect(raw).toContain('title: Authentication Rules');
    expect(raw).toContain('All API calls require a bearer token.');
  });

  // T03-3: List all topics
  it('lists all topics sorted by title', async () => {
    await store.save(tmpDir, { slug: 'b-topic', title: 'Beta', content: 'B', updatedAt: new Date().toISOString() });
    await store.save(tmpDir, { slug: 'a-topic', title: 'Alpha', content: 'A', updatedAt: new Date().toISOString() });
    const list = await store.list(tmpDir);
    expect(list).toHaveLength(2);
    expect(list[0].slug).toBe('a-topic');
    expect(list[1].slug).toBe('b-topic');
  });

  // T03-4: Get non-existent topic returns null
  it('returns null for non-existent slug', async () => {
    const topic = await store.get(tmpDir, 'does-not-exist');
    expect(topic).toBeNull();
  });

  // T03-5: Delete a topic
  it('deletes a topic file', async () => {
    await store.save(tmpDir, { slug: 'temp', title: 'Temp', content: 'X', updatedAt: new Date().toISOString() });
    await store.delete(tmpDir, 'temp');
    const topic = await store.get(tmpDir, 'temp');
    expect(topic).toBeNull();
  });

  // T03-6: Prepare change for new topic
  it('prepareChange returns null previousContent for new topic', async () => {
    const change = await store.prepareChange(tmpDir, 'new-topic', 'New Topic', 'Fresh content');
    expect(change.previousContent).toBeNull();
    expect(change.proposedContent).toBe('Fresh content');
    expect(change.isConflict).toBe(false);
  });

  // T03-7: Prepare change for existing topic detects conflict
  it('prepareChange flags conflict when existing content differs', async () => {
    await store.save(tmpDir, { slug: 'policy', title: 'Policy', content: 'Old rule A\n\nOld rule B', updatedAt: new Date().toISOString() });
    const change = await store.prepareChange(tmpDir, 'policy', 'Policy', 'New rule C');
    expect(change.previousContent).toBe('Old rule A\n\nOld rule B');
    expect(change.isConflict).toBe(true);
  });

  // T03-8: hasChanged detects concurrent modification
  it('hasChanged returns true when file was modified externally', async () => {
    await store.save(tmpDir, { slug: 'rule', title: 'Rule', content: 'Version 1', updatedAt: new Date().toISOString() });
    // Simulate external edit
    await store.save(tmpDir, { slug: 'rule', title: 'Rule', content: 'Version 2', updatedAt: new Date().toISOString() });
    const changed = await store.hasChanged(tmpDir, 'rule', 'Version 1');
    expect(changed).toBe(true);
  });

  // T03-9: hasChanged returns false when content matches
  it('hasChanged returns false when content is unchanged', async () => {
    await store.save(tmpDir, { slug: 'rule', title: 'Rule', content: 'Same', updatedAt: new Date().toISOString() });
    const changed = await store.hasChanged(tmpDir, 'rule', 'Same');
    expect(changed).toBe(false);
  });

  // T03-10: Slug validation rejects path traversal
  it('rejects slugs with path traversal', async () => {
    await expect(store.save(tmpDir, {
      slug: '../../../etc/passwd',
      title: 'Hack',
      content: 'Bad',
      updatedAt: new Date().toISOString(),
    })).rejects.toThrow();
  });

  // T03-11: Slug validation rejects special characters
  it('rejects slugs with special characters', async () => {
    await expect(store.save(tmpDir, {
      slug: 'hello world!',
      title: 'Bad Slug',
      content: 'X',
      updatedAt: new Date().toISOString(),
    })).rejects.toThrow();
  });

  // T03-12: Empty knowledge directory returns empty list
  it('returns empty list when no knowledge exists', async () => {
    const list = await store.list(tmpDir);
    expect(list).toEqual([]);
  });

  // T03-13: Overwrite existing topic
  it('overwrites existing topic content on save', async () => {
    await store.save(tmpDir, { slug: 'rule', title: 'Rule', content: 'V1', updatedAt: new Date().toISOString() });
    await store.save(tmpDir, { slug: 'rule', title: 'Rule', content: 'V2', updatedAt: new Date().toISOString() });
    const topic = await store.get(tmpDir, 'rule');
    expect(topic!.content).toBe('V2');
  });
});
```
