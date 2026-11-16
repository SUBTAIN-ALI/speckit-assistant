# Ticket 13: Source Citation System

**Priority:** P1  
**Depends On:** Ticket 05  
**Requirements Ref:** Sections 6.1, 6.2, 6.3, AC-07  
**Estimated Effort:** Medium  

## Description

Implement a citation system that tracks and displays the sources the chatbot used to form its answer. Citations are evidence that the answer is grounded in actual project material, not invented.

The system has two parts:
1. **Extraction**: Parse citations from the agent's response (the agent is prompted to include source references)
2. **Display**: Toggleable citation view in the UI

Citations are hidden by default. The user can turn them on globally or request them per-message.

## Implementation Approach

### Agent-Side: Structured Citation Output

The `READ_ONLY_SYSTEM_PROMPT` in Ticket 04 already instructs the agent to note sources. Enhance it to output citations in a parseable format:

```
When referencing evidence, include inline citations in this format:
[source: file:src/services/auth.ts:42-55]
[source: spec:user-auth/spec.md]
[source: git:abc1234 "Added refund validation"]
[source: knowledge:refund-policy]
[source: meeting:2026-11-10-standup/requirements.md]
```

### Extraction: Parse Citations from Response

### `src/chatbot/domain/CitationParser.ts`

```typescript
import { CitationSource } from './models';

export function extractCitations(responseText: string): {
  cleanText: string;       // response with citation markers removed
  citations: CitationSource[];
} {
  const citationRegex = /\[source:\s*(file|spec|git|knowledge|meeting):([^\]]+)\]/g;
  const citations: CitationSource[] = [];
  
  let match;
  while ((match = citationRegex.exec(responseText)) !== null) {
    citations.push(parseCitation(match[1], match[2]));
  }
  
  const cleanText = responseText.replace(citationRegex, '').trim();
  return { cleanText, citations };
}

function parseCitation(type: string, value: string): CitationSource {
  // Parse type-specific formats:
  // file:src/auth.ts:42-55  → { type: 'file', path: 'src/auth.ts', lineStart: 42, lineEnd: 55 }
  // spec:user-auth/spec.md  → { type: 'spec', path: 'specs/user-auth/spec.md' }
  // git:abc1234 "message"   → { type: 'git', path: 'abc1234', label: 'message' }
  // etc.
}
```

### Display: CitationView Component

### `src/chatbot/components/CitationView.tsx`

```typescript
type Props = {
  citations: CitationSource[];
  visible: boolean;
};
```

- Renders as a collapsible section below an assistant message
- Each citation shows: icon (file/spec/git/etc), path, and line numbers if applicable
- File citations are clickable (could open in the IDE or code viewer — future enhancement)
- Toggle button: "Show sources" / "Hide sources"

### Integration with ChatPanel

- Add a global toggle: "Show citations" in the chat header settings
- Per-message: clicking "Sources" on an assistant message expands its citations
- The `ChatbotService` runs `extractCitations()` on the completed response and stores the parsed citations alongside the message

## Acceptance Criteria

- [ ] Agent responses include parseable citation markers
- [ ] `CitationParser` extracts citations and cleans response text
- [ ] Citations stored in `ChatMessage.citations[]`
- [ ] Citation view toggleable per-message and globally
- [ ] Citation types supported: file, spec, git, knowledge, meeting, review
- [ ] Citations remain available in historical responses (AC-07)
- [ ] Citations hidden by default, shown on request

## Test Cases

### `src/chatbot/domain/__tests__/CitationParser.test.ts`

```typescript
import { extractCitations } from '../CitationParser';

describe('CitationParser', () => {
  // T13-1: Extract file citation
  it('extracts file citation with line numbers', () => {
    const text = 'The auth module validates tokens [source: file:src/auth.ts:42-55] here.';
    const { cleanText, citations } = extractCitations(text);
    expect(citations).toHaveLength(1);
    expect(citations[0].type).toBe('file');
    expect(citations[0].path).toBe('src/auth.ts');
    expect(citations[0].lineStart).toBe(42);
    expect(citations[0].lineEnd).toBe(55);
    expect(cleanText).toBe('The auth module validates tokens here.');
  });

  // T13-2: Extract spec citation
  it('extracts spec citation', () => {
    const text = 'According to the spec [source: spec:user-auth/spec.md], this should...';
    const { citations } = extractCitations(text);
    expect(citations[0].type).toBe('spec');
    expect(citations[0].path).toContain('user-auth');
  });

  // T13-3: Extract git citation
  it('extracts git commit citation', () => {
    const text = 'This was changed in [source: git:abc1234 "Added validation"]';
    const { citations } = extractCitations(text);
    expect(citations[0].type).toBe('git');
    expect(citations[0].path).toBe('abc1234');
    expect(citations[0].label).toBe('Added validation');
  });

  // T13-4: Extract knowledge citation
  it('extracts knowledge topic citation', () => {
    const text = 'The refund policy states [source: knowledge:refund-policy] that...';
    const { citations } = extractCitations(text);
    expect(citations[0].type).toBe('knowledge');
    expect(citations[0].path).toBe('refund-policy');
  });

  // T13-5: Multiple citations in one response
  it('extracts multiple citations', () => {
    const text = 'Auth [source: file:src/auth.ts:10] uses JWT [source: knowledge:auth-rules].';
    const { citations } = extractCitations(text);
    expect(citations).toHaveLength(2);
  });

  // T13-6: No citations returns empty array
  it('returns empty array when no citations present', () => {
    const { citations } = extractCitations('Just a plain answer.');
    expect(citations).toEqual([]);
  });

  // T13-7: Clean text removes citation markers
  it('removes citation markers from clean text', () => {
    const text = 'A [source: file:a.ts:1] B [source: spec:b/c.md] C';
    const { cleanText } = extractCitations(text);
    expect(cleanText).toBe('A B C');
  });

  // T13-8: File citation without line numbers
  it('handles file citation without line numbers', () => {
    const text = '[source: file:package.json]';
    const { citations } = extractCitations(text);
    expect(citations[0].lineStart).toBeUndefined();
  });

  // T13-9: Meeting citation
  it('extracts meeting citation', () => {
    const text = '[source: meeting:2026-11-10/requirements.md]';
    const { citations } = extractCitations(text);
    expect(citations[0].type).toBe('meeting');
  });
});
```
