# Ticket 12: Knowledge Conflict Resolution

**Priority:** P1  
**Depends On:** Ticket 10  
**Requirements Ref:** Sections 4.3, 4.4, 9.3  
**Estimated Effort:** Small  

## Description

When new domain knowledge conflicts with an existing saved topic, the chatbot must:

1. Detect the conflict (existing topic has content that would be removed/contradicted)
2. Show the user a targeted replacement preview (old vs new, side by side)
3. Ensure the replacement doesn't silently remove unrelated text
4. If the replacement is ambiguous, ask the user for clarification rather than deciding

This ticket enhances the `KnowledgeApprovalModal` (Ticket 10) and the `KnowledgeStore.prepareChange()` logic (Ticket 03).

## Changes Required

### `FSKnowledgeStore.prepareChange()` Enhancement

Improve conflict detection:

```typescript
async prepareChange(projectPath: string, slug: string, title: string, proposedContent: string): Promise<KnowledgeChange> {
  const existing = await this.get(projectPath, slug);
  if (!existing) {
    return { slug, title, previousContent: null, proposedContent, isConflict: false };
  }
  
  // Conflict detection: check if proposed content would lose existing paragraphs
  const existingParagraphs = existing.content.split(/\n\n+/).filter(Boolean);
  const proposedParagraphs = proposedContent.split(/\n\n+/).filter(Boolean);
  
  const lostParagraphs = existingParagraphs.filter(ep =>
    !proposedParagraphs.some(pp => pp.includes(ep.trim()) || ep.trim().includes(pp))
  );
  
  return {
    slug,
    title,
    previousContent: existing.content,
    proposedContent,
    isConflict: lostParagraphs.length > 0,
  };
}
```

### `KnowledgeApprovalModal` Enhancement

When `isConflict: true`:
- Show a yellow/amber warning banner: "This change would replace existing information. Review carefully."
- Highlight removed paragraphs in red in the "Current" panel
- Highlight added paragraphs in green in the "Proposed" panel
- Show a "Merge instead" option that combines old and new content (appends proposed to existing)

### `hasChanged()` — Concurrent Edit Guard

Before saving an approved change, check if the file was modified since the preview was generated:

```typescript
// In the save flow:
const changed = await knowledgeStore.hasChanged(projectPath, slug, expectedPreviousContent);
if (changed) {
  // Re-prepare the change with current content
  // Show updated approval modal with fresh diff
  // User must re-approve
}
```

## Acceptance Criteria

- [ ] Conflicting changes detected when existing paragraphs would be lost
- [ ] Conflict warning displayed in approval modal (AC-09)
- [ ] Side-by-side diff highlights removed/added content
- [ ] "Merge instead" option available for conflicts
- [ ] Concurrent edits detected: if file changed before approval, re-prepare and re-show
- [ ] Silent removal of unrelated text prevented
- [ ] Ambiguous replacements prompt clarification from user

## Test Cases

### `src/chatbot/adapters/__tests__/FSKnowledgeStore.conflict.test.ts`

```typescript
describe('FSKnowledgeStore - Conflict Detection', () => {
  // T12-1: No conflict when topic is new
  it('no conflict for new topic', async () => {
    const change = await store.prepareChange(tmpDir, 'new-topic', 'New', 'Content');
    expect(change.isConflict).toBe(false);
    expect(change.previousContent).toBeNull();
  });

  // T12-2: No conflict when proposed extends existing
  it('no conflict when proposed content contains all existing paragraphs', async () => {
    await store.save(tmpDir, { slug: 'policy', title: 'Policy', content: 'Rule A\n\nRule B', updatedAt: '' });
    const change = await store.prepareChange(tmpDir, 'policy', 'Policy', 'Rule A\n\nRule B\n\nRule C');
    expect(change.isConflict).toBe(false);
  });

  // T12-3: Conflict when proposed removes existing paragraph
  it('conflict when existing paragraphs would be lost', async () => {
    await store.save(tmpDir, { slug: 'policy', title: 'Policy', content: 'Rule A\n\nRule B\n\nRule C', updatedAt: '' });
    const change = await store.prepareChange(tmpDir, 'policy', 'Policy', 'Rule A\n\nRule D');
    expect(change.isConflict).toBe(true);
  });

  // T12-4: Conflict when proposed replaces all content
  it('conflict when completely replacing content', async () => {
    await store.save(tmpDir, { slug: 'policy', title: 'Policy', content: 'Old content', updatedAt: '' });
    const change = await store.prepareChange(tmpDir, 'policy', 'Policy', 'Totally new content');
    expect(change.isConflict).toBe(true);
  });

  // T12-5: Concurrent edit detected
  it('hasChanged detects concurrent edit between prepare and save', async () => {
    await store.save(tmpDir, { slug: 'rule', title: 'Rule', content: 'V1', updatedAt: '' });
    const change = await store.prepareChange(tmpDir, 'rule', 'Rule', 'V2');
    // Simulate concurrent edit
    await store.save(tmpDir, { slug: 'rule', title: 'Rule', content: 'V1-modified', updatedAt: '' });
    const changed = await store.hasChanged(tmpDir, 'rule', change.previousContent);
    expect(changed).toBe(true);
  });

  // T12-6: No concurrent edit when file unchanged
  it('hasChanged returns false when no concurrent edit', async () => {
    await store.save(tmpDir, { slug: 'rule', title: 'Rule', content: 'V1', updatedAt: '' });
    const change = await store.prepareChange(tmpDir, 'rule', 'Rule', 'V2');
    const changed = await store.hasChanged(tmpDir, 'rule', change.previousContent);
    expect(changed).toBe(false);
  });
});
```

### `src/chatbot/components/__tests__/KnowledgeApprovalModal.conflict.test.tsx`

```typescript
describe('KnowledgeApprovalModal - Conflict UI', () => {
  // T12-7: Shows conflict warning
  it('displays warning banner for conflicting changes', () => {
    render(<KnowledgeApprovalModal change={conflictChange} open={true}
      onApprove={jest.fn()} onReject={jest.fn()} />);
    expect(screen.getByText(/replace existing information/i)).toBeInTheDocument();
  });

  // T12-8: Shows merge option
  it('shows "Merge instead" button for conflicts', () => {
    render(<KnowledgeApprovalModal change={conflictChange} open={true}
      onApprove={jest.fn()} onReject={jest.fn()} />);
    expect(screen.getByText(/merge/i)).toBeInTheDocument();
  });

  // T12-9: Merge combines old and new
  it('merge option proposes combined content', () => {
    const onApprove = jest.fn();
    render(<KnowledgeApprovalModal change={conflictChange} open={true}
      onApprove={onApprove} onReject={jest.fn()} />);
    fireEvent.click(screen.getByText(/merge/i));
    // Verify proposed content now includes both old and new
  });
});
```
