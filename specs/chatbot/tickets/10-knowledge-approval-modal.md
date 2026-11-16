# Ticket 10: Knowledge Approval Modal

**Priority:** P1  
**Depends On:** Tickets 03, 08  
**Requirements Ref:** Sections 4.3, 4.4, 9.3  
**Estimated Effort:** Medium  

## Description

When the user asks the chatbot to save domain knowledge (e.g., "Remember that refunds require manager approval"), the chatbot proposes a knowledge change. This modal shows the user:

1. **Destination**: Which topic file will be created/updated
2. **Current content** (if updating): What's already saved
3. **Proposed content**: What the chatbot wants to save
4. **Diff view** (if updating): Side-by-side or inline diff of old vs new
5. **Approve / Reject** buttons

Nothing is saved until the user explicitly approves.

## Files to Create

### `src/chatbot/components/KnowledgeApprovalModal.tsx`

```typescript
type Props = {
  change: KnowledgeChange;
  open: boolean;
  onApprove: () => void;
  onReject: () => void;
};
```

**Layout:**

```
┌─────────────────────────────────────────┐
│ Save Domain Knowledge                   │
│─────────────────────────────────────────│
│ Topic: Refund Policy                    │
│ File: .specify/chatbot/knowledge/       │
│       refund-policy.md                  │
│─────────────────────────────────────────│
│ ┌─ Current ──────┐ ┌─ Proposed ───────┐│
│ │ Refunds are    │ │ Refunds require  ││
│ │ processed in   │ │ manager approval ││
│ │ 14 days.       │ │ and are processed││
│ │                │ │ in 14 days.      ││
│ └────────────────┘ └─────────────────-┘│
│─────────────────────────────────────────│
│            [Reject]  [Approve]          │
└─────────────────────────────────────────┘
```

- For new topics (no `previousContent`): show only proposed content, no diff
- For updates: side-by-side diff with added/removed highlighting
- For conflicts (`isConflict: true`): show a warning banner explaining that the new content removes existing information
- Diff rendering: use simple line-by-line comparison (added=green, removed=red, unchanged=gray)

### Integration with ChatPanel

When the chatbot's response includes a knowledge-save proposal (detected via a structured marker in the response), the `ChatPanel` parses it and shows the approval modal. The flow:

1. Chatbot response includes structured block: `<!-- KNOWLEDGE_PROPOSAL: {"slug": "...", "title": "...", "content": "..."} -->`
2. ChatPanel detects this marker, calls `/api/chatbot/knowledge/prepare` to get the `KnowledgeChange`
3. Opens `KnowledgeApprovalModal`
4. On approve: calls `/api/chatbot/knowledge/save`
5. On reject: closes modal, no save

### API Endpoints Needed

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/chatbot/knowledge/prepare` | Prepare a change preview (returns `KnowledgeChange`) |
| POST | `/api/chatbot/knowledge/save` | Save approved knowledge |
| GET | `/api/chatbot/knowledge` | List all knowledge topics |
| DELETE | `/api/chatbot/knowledge/[slug]` | Delete a topic |

## Acceptance Criteria

- [ ] Modal shows topic destination, current content, proposed content
- [ ] New topics show only proposed content
- [ ] Updates show side-by-side diff with color coding
- [ ] Conflicts show warning banner
- [ ] Approve button saves and closes modal
- [ ] Reject button closes modal without saving
- [ ] Nothing saved without explicit user approval (AC-08)
- [ ] Modal accessible: focus trapped, Escape closes

## Test Cases

### `src/chatbot/components/__tests__/KnowledgeApprovalModal.test.tsx`

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { KnowledgeApprovalModal } from '../KnowledgeApprovalModal';
import { KnowledgeChange } from '../../domain/models';

describe('KnowledgeApprovalModal', () => {
  const newTopic: KnowledgeChange = {
    slug: 'refund-policy',
    title: 'Refund Policy',
    previousContent: null,
    proposedContent: 'Refunds require manager approval.',
    isConflict: false,
  };

  const updateTopic: KnowledgeChange = {
    slug: 'refund-policy',
    title: 'Refund Policy',
    previousContent: 'Refunds processed in 14 days.',
    proposedContent: 'Refunds require manager approval and are processed in 14 days.',
    isConflict: false,
  };

  const conflictTopic: KnowledgeChange = {
    slug: 'refund-policy',
    title: 'Refund Policy',
    previousContent: 'Refunds processed in 14 days.\n\nNo exceptions.',
    proposedContent: 'Refunds require manager approval.',
    isConflict: true,
  };

  // T10-1: Shows proposed content for new topic
  it('shows only proposed content for new topic', () => {
    render(<KnowledgeApprovalModal change={newTopic} open={true}
      onApprove={jest.fn()} onReject={jest.fn()} />);
    expect(screen.getByText(/refund policy/i)).toBeInTheDocument();
    expect(screen.getByText(/manager approval/i)).toBeInTheDocument();
    expect(screen.queryByText(/current/i)).not.toBeInTheDocument();
  });

  // T10-2: Shows diff for update
  it('shows current and proposed content for update', () => {
    render(<KnowledgeApprovalModal change={updateTopic} open={true}
      onApprove={jest.fn()} onReject={jest.fn()} />);
    expect(screen.getByText(/current/i)).toBeInTheDocument();
    expect(screen.getByText(/proposed/i)).toBeInTheDocument();
  });

  // T10-3: Shows conflict warning
  it('shows warning banner for conflicts', () => {
    render(<KnowledgeApprovalModal change={conflictTopic} open={true}
      onApprove={jest.fn()} onReject={jest.fn()} />);
    expect(screen.getByText(/conflict/i)).toBeInTheDocument();
  });

  // T10-4: Approve calls onApprove
  it('calls onApprove when approve button clicked', () => {
    const onApprove = jest.fn();
    render(<KnowledgeApprovalModal change={newTopic} open={true}
      onApprove={onApprove} onReject={jest.fn()} />);
    fireEvent.click(screen.getByText(/approve/i));
    expect(onApprove).toHaveBeenCalled();
  });

  // T10-5: Reject calls onReject
  it('calls onReject when reject button clicked', () => {
    const onReject = jest.fn();
    render(<KnowledgeApprovalModal change={newTopic} open={true}
      onApprove={jest.fn()} onReject={onReject} />);
    fireEvent.click(screen.getByText(/reject/i));
    expect(onReject).toHaveBeenCalled();
  });

  // T10-6: Nothing saved on reject (AC-08)
  it('no API call made when rejected', () => {
    const onReject = jest.fn();
    render(<KnowledgeApprovalModal change={newTopic} open={true}
      onApprove={jest.fn()} onReject={onReject} />);
    fireEvent.click(screen.getByText(/reject/i));
    // Verify no fetch calls to save endpoint
  });

  // T10-7: Modal not visible when open=false
  it('hidden when open is false', () => {
    render(<KnowledgeApprovalModal change={newTopic} open={false}
      onApprove={jest.fn()} onReject={jest.fn()} />);
    expect(screen.queryByText(/refund policy/i)).not.toBeInTheDocument();
  });

  // T10-8: Escape closes (rejects)
  it('calls onReject when Escape pressed', () => {
    const onReject = jest.fn();
    render(<KnowledgeApprovalModal change={newTopic} open={true}
      onApprove={jest.fn()} onReject={onReject} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onReject).toHaveBeenCalled();
  });
});
```
