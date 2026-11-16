# Ticket 08: ChatPanel UI — Rewrite with Persistence

**Priority:** P0  
**Depends On:** Ticket 07  
**Requirements Ref:** Sections 5.4, 8.1, 8.2, 8.3  
**Estimated Effort:** Large  

## Description

Rewrite the ChatPanel component to use the new chatbot API endpoints. The current `src/components/ChatPanel.tsx` uses in-memory state and calls `/api/chat`. The new version calls `/api/chatbot/chat`, supports persistent conversations, conversation switching, and reflects all required UI states.

The new component lives in `src/chatbot/components/ChatPanel.tsx`. The old `src/components/ChatPanel.tsx` is deleted. The host `page.tsx` imports from `src/chatbot/index.ts`.

## Files to Create

### `src/chatbot/components/ChatPanel.tsx`

Key differences from the current component:

1. **Conversation persistence**: On mount, loads conversation list from `/api/chatbot/conversations`. User can switch between recent conversations or start a new one.
2. **SSE meta event**: After sending a message, the first SSE event is `meta` with `conversationId` — store this for subsequent messages.
3. **Message status**: Each message shows its status (complete, streaming, canceled, error).
4. **Conversation header**: Shows conversation title (derived from first message) and a dropdown to switch/create conversations.
5. **Empty state**: "Ask anything about your project" with suggested starter questions.
6. **Investigating state**: While the agent is working, show "Investigating..." with a pulsing indicator.
7. **Error recovery**: Display error inline, allow retry.

### Component Structure

```
ChatPanel (main container)
├── ConversationHeader
│   ├── Title (auto-derived or "New Conversation")
│   ├── Conversation switcher dropdown
│   └── New conversation button
├── MessageList
│   ├── UserMessage (right-aligned bubble)
│   ├── AssistantMessage (left-aligned, markdown rendered)
│   │   └── StatusIndicator (streaming/canceled/error)
│   └── EmptyState (starter questions)
├── ErrorBanner (when error state)
└── InputBar
    ├── Textarea (auto-resize, shift+enter for newline)
    ├── Send button
    └── Stop button (visible during streaming)
```

### Props

```typescript
type ChatPanelProps = {
  active: boolean;        // whether the panel is visible
  expanded?: boolean;     // expanded modal mode (Ticket 09)
  onExpandToggle?: () => void;
};
```

### State Management

```typescript
// Conversation list (loaded once, refreshed on new/delete)
const [conversations, setConversations] = useState<ConversationSummary[]>([]);
// Active conversation
const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
// Active conversation ID (persisted between renders)
const [activeId, setActiveId] = useState<string | null>(null);
// Messages for current conversation
const [messages, setMessages] = useState<ChatMessage[]>([]);
// Chat state
const [chatState, setChatState] = useState<ChatState>('ready');
// Current input
const [input, setInput] = useState('');
// Abort controller for stopping
const abortRef = useRef<(() => void) | null>(null);
```

### API Integration

```typescript
// Send message
async function sendMessage(text: string) {
  setChatState('investigating');
  const res = await fetch('/api/chatbot/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversationId: activeId,
      message: text,
    }),
  });
  
  // Stream SSE response
  for await (const event of readSse(res)) {
    if (event.type === 'meta') {
      setActiveId(event.data.conversationId);
    } else if (event.type === 'token') {
      // Append to assistant message
    } else if (event.type === 'done') {
      setChatState('ready');
    } else if (event.type === 'error') {
      setChatState('error');
    }
  }
}
```

## Files to Delete

- `src/components/ChatPanel.tsx` (old)

## Files to Modify

### `src/app/page.tsx`

- Change import from `src/components/ChatPanel` to `src/chatbot` (via index.ts)
- The ChatPanel props interface may change slightly

### `src/chatbot/index.ts`

- Add: `export { ChatPanel } from './components/ChatPanel';`

## Acceptance Criteria

- [ ] New `ChatPanel` in `src/chatbot/components/` uses `/api/chatbot/chat` endpoint
- [ ] Conversations persist: closing and reopening shows previous messages
- [ ] Conversation switcher: dropdown lists recent conversations (last 7 days)
- [ ] New conversation: button creates fresh conversation
- [ ] Message status indicators: streaming (pulsing dot), canceled (strikethrough), error (red)
- [ ] "Investigating..." state while agent is working
- [ ] Stop button visible during streaming, calls `/api/chatbot/conversations/[id]/stop`
- [ ] Empty state with starter question suggestions
- [ ] Old `src/components/ChatPanel.tsx` deleted
- [ ] Keyboard: Enter sends, Shift+Enter newline
- [ ] Auto-scroll to newest message
- [ ] Accessible: screen reader labels on buttons, focus management

## Test Cases

### `src/chatbot/components/__tests__/ChatPanel.test.tsx`

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChatPanel } from '../ChatPanel';

// Mock fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('ChatPanel', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  // T08-1: Renders empty state
  it('shows empty state when no conversations', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ conversations: [] }),
    });
    render(<ChatPanel active={true} />);
    await waitFor(() => {
      expect(screen.getByText(/ask anything/i)).toBeInTheDocument();
    });
  });

  // T08-2: Loads existing conversations on mount
  it('loads conversation list on mount', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        conversations: [{ id: 'c1', title: 'Auth question', updatedAt: new Date().toISOString(), messages: [] }],
      }),
    });
    render(<ChatPanel active={true} />);
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/chatbot/conversations');
    });
  });

  // T08-3: Send message triggers API call
  it('sends message to /api/chatbot/chat', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ conversations: [] }) })
      .mockResolvedValueOnce({
        ok: true,
        body: new ReadableStream({ start(ctrl) { ctrl.close(); } }),
      });
    render(<ChatPanel active={true} />);
    const input = screen.getByPlaceholderText(/ask about/i);
    fireEvent.change(input, { target: { value: 'What does auth do?' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/chatbot/chat', expect.objectContaining({
        method: 'POST',
      }));
    });
  });

  // T08-4: Enter sends, Shift+Enter doesn't
  it('Enter sends message, Shift+Enter inserts newline', () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ conversations: [] }) });
    render(<ChatPanel active={true} />);
    const input = screen.getByPlaceholderText(/ask about/i);
    fireEvent.change(input, { target: { value: 'test' } });
    
    // Shift+Enter should NOT send
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    // Enter should send
    fireEvent.keyDown(input, { key: 'Enter' });
  });

  // T08-5: Stop button appears during streaming
  it('shows stop button while streaming', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ conversations: [] }) });
    render(<ChatPanel active={true} />);
    // Simulate streaming state
    // The stop button should be visible when chatState === 'investigating'
  });

  // T08-6: Canceled message shows status
  it('displays canceled message with status indicator', () => {
    // Render a message with status: 'canceled'
    // Verify visual indicator is present
  });

  // T08-7: Conversation switcher
  it('switches between conversations', async () => {
    const convs = [
      { id: 'c1', title: 'First', updatedAt: new Date().toISOString(), messages: [] },
      { id: 'c2', title: 'Second', updatedAt: new Date().toISOString(), messages: [] },
    ];
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ conversations: convs }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(convs[1]) });
    render(<ChatPanel active={true} />);
    // Click conversation switcher, select "Second"
    // Verify messages update
  });

  // T08-8: New conversation button
  it('clears messages and resets activeId on new conversation', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ conversations: [{ id: 'c1', title: 'Old', updatedAt: '', messages: [] }] }),
    });
    render(<ChatPanel active={true} />);
    // Click "New conversation" button
    // Verify messages are empty and no activeId
  });

  // T08-9: Auto-scroll on new message
  it('scrolls to bottom when new message arrives', async () => {
    // Verify scrollIntoView is called on message addition
  });

  // T08-10: Panel hidden when not active
  it('does not render content when active=false', () => {
    render(<ChatPanel active={false} />);
    expect(screen.queryByPlaceholderText(/ask about/i)).not.toBeInTheDocument();
  });
});
```
