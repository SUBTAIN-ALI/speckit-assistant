# Ticket 18: Conversation History Browser

**Priority:** P1  
**Depends On:** Tickets 02, 08  
**Requirements Ref:** Sections 5.4, 8.1, 8.2  
**Estimated Effort:** Small  

## Description

Add a conversation history sidebar/dropdown within the ChatPanel that lets users:
1. Browse past conversations (within the 7-day retention window)
2. Resume a previous conversation (ask new questions with prior context)
3. Delete old conversations
4. See which conversations are active vs. completed

The history list is loaded from `/api/chatbot/conversations` and shows conversations sorted by most recently updated.

## Files to Create

### `src/chatbot/components/ConversationList.tsx`

```typescript
type ConversationSummary = {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
};

type Props = {
  conversations: ConversationSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
};
```

**Layout in side panel mode:**
- Dropdown in the ChatPanel header showing current conversation title
- Click to expand: shows recent conversations as a list
- Each item: title (truncated to 1 line), relative time ("2h ago", "Yesterday"), message count badge
- "New conversation" button at the top
- Delete button (trash icon) on hover for each item

**Layout in expanded modal mode:**
- Left sidebar (~250px) showing the full conversation list
- Active conversation highlighted
- Same items as above but always visible (not a dropdown)

### Integration with ChatPanel

- On mount: fetch conversation list
- On conversation select: fetch full conversation from `/api/chatbot/conversations/[id]` and display messages
- On new conversation: clear messages, reset activeId
- On delete: remove from list, if active then switch to most recent or new

### Time Display

```typescript
function relativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 172800000) return 'Yesterday';
  return `${Math.floor(diff / 86400000)}d ago`;
}
```

## Acceptance Criteria

- [ ] Conversation list loaded from API on mount
- [ ] Conversations sorted by `updatedAt` descending (most recent first)
- [ ] Clicking a conversation loads its messages
- [ ] "New conversation" starts a fresh chat
- [ ] Delete removes conversation (with confirmation for non-empty conversations)
- [ ] Relative time display ("2h ago", "Yesterday", "5d ago")
- [ ] Active conversation visually highlighted
- [ ] Works in both side panel (dropdown) and expanded (sidebar) modes

## Test Cases

### `src/chatbot/components/__tests__/ConversationList.test.tsx`

```typescript
describe('ConversationList', () => {
  const conversations = [
    { id: 'c1', title: 'Auth question', updatedAt: new Date().toISOString(), messageCount: 4 },
    { id: 'c2', title: 'Refund flow', updatedAt: new Date(Date.now() - 86400000).toISOString(), messageCount: 2 },
  ];

  // T18-1: Renders conversation list
  it('renders all conversations', () => {
    render(<ConversationList conversations={conversations} activeId="c1"
      onSelect={jest.fn()} onNew={jest.fn()} onDelete={jest.fn()} />);
    expect(screen.getByText(/auth question/i)).toBeInTheDocument();
    expect(screen.getByText(/refund flow/i)).toBeInTheDocument();
  });

  // T18-2: Active conversation highlighted
  it('highlights active conversation', () => {
    render(<ConversationList conversations={conversations} activeId="c1"
      onSelect={jest.fn()} onNew={jest.fn()} onDelete={jest.fn()} />);
    const active = screen.getByText(/auth question/i).closest('[data-active]');
    expect(active?.getAttribute('data-active')).toBe('true');
  });

  // T18-3: Click selects conversation
  it('calls onSelect when conversation clicked', () => {
    const onSelect = jest.fn();
    render(<ConversationList conversations={conversations} activeId="c1"
      onSelect={onSelect} onNew={jest.fn()} onDelete={jest.fn()} />);
    fireEvent.click(screen.getByText(/refund flow/i));
    expect(onSelect).toHaveBeenCalledWith('c2');
  });

  // T18-4: New conversation button
  it('calls onNew when new button clicked', () => {
    const onNew = jest.fn();
    render(<ConversationList conversations={conversations} activeId="c1"
      onSelect={jest.fn()} onNew={onNew} onDelete={jest.fn()} />);
    fireEvent.click(screen.getByText(/new/i));
    expect(onNew).toHaveBeenCalled();
  });

  // T18-5: Delete with confirmation
  it('calls onDelete when delete confirmed', () => {
    const onDelete = jest.fn();
    render(<ConversationList conversations={conversations} activeId="c1"
      onSelect={jest.fn()} onNew={jest.fn()} onDelete={onDelete} />);
    // Hover over conversation to show delete button, click it
    // Confirm deletion
    // expect(onDelete).toHaveBeenCalledWith('c1');
  });

  // T18-6: Relative time display
  it('shows relative time for conversations', () => {
    render(<ConversationList conversations={conversations} activeId={null}
      onSelect={jest.fn()} onNew={jest.fn()} onDelete={jest.fn()} />);
    // First conversation: recent → should show "Just now" or "Xm ago"
    // Second conversation: 1 day old → should show "Yesterday"
  });

  // T18-7: Empty state
  it('shows empty state when no conversations', () => {
    render(<ConversationList conversations={[]} activeId={null}
      onSelect={jest.fn()} onNew={jest.fn()} onDelete={jest.fn()} />);
    expect(screen.getByText(/no conversations/i)).toBeInTheDocument();
  });

  // T18-8: Message count badge
  it('shows message count for each conversation', () => {
    render(<ConversationList conversations={conversations} activeId={null}
      onSelect={jest.fn()} onNew={jest.fn()} onDelete={jest.fn()} />);
    expect(screen.getByText('4')).toBeInTheDocument();
  });
});
```
