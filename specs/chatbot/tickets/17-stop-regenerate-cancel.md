# Ticket 17: Stop / Regenerate / Cancel Controls

**Priority:** P1  
**Depends On:** Ticket 08  
**Requirements Ref:** Sections 5.5, 8.2  
**Estimated Effort:** Medium  

## Description

Implement user controls for managing in-flight and completed chatbot responses:

1. **Stop**: Halt a currently streaming response. The partial response is preserved with status `canceled`.
2. **Regenerate**: Re-run the last question against current project state. The old answer is kept (marked as superseded), and a new answer is generated.
3. **Cancel**: Abort before any response arrives. Removes the pending assistant message.

These controls must not affect unrelated conversations or implementation tasks (AC-12).

## UI Controls

### Stop Button
- Visible only during streaming (replaces Send button)
- Calls `response.stop()` which hits `/api/chatbot/conversations/[id]/stop`
- Partial response preserved with "Response interrupted" indicator

### Regenerate Button
- Visible on the last assistant message when complete
- Icon: `RefreshCw` from lucide-react
- On click: re-sends the last user message as a new request
- The old assistant response is marked with "Superseded — regenerated" label
- New response uses current project state (which may have changed since the original)

### Cancel
- If user presses Escape or clicks Stop before any tokens arrive, remove the empty assistant message entirely
- User message remains in history

## Implementation

### ChatPanel Changes

```typescript
// Stop: visible during streaming
const handleStop = () => {
  if (abortRef.current) {
    abortRef.current();
    abortRef.current = null;
  }
};

// Regenerate: re-send last user message
const handleRegenerate = () => {
  const lastUserMsg = messages.filter(m => m.role === 'user').pop();
  if (lastUserMsg) {
    sendMessage(lastUserMsg.content);
  }
};
```

### Message Status Display

| Status | Visual |
|---|---|
| `complete` | Normal display |
| `streaming` | Pulsing cursor at end |
| `canceled` | Gray text + "Interrupted" badge |
| `error` | Red border + error message |
| Superseded | Faded + "Regenerated" badge (not a status — a UI-only label for the previous answer) |

## Acceptance Criteria

- [ ] Stop button visible during streaming, hidden otherwise
- [ ] Stopping preserves partial response with `canceled` status
- [ ] Regenerate button visible on last complete assistant message
- [ ] Regeneration uses current project state
- [ ] Old response marked as superseded when regenerated
- [ ] Cancel (no tokens yet) removes empty assistant placeholder
- [ ] Stopping one response does not affect other conversations or implementation (AC-12)
- [ ] Keyboard: Escape during streaming triggers stop

## Test Cases

### `src/chatbot/components/__tests__/ChatControls.test.tsx`

```typescript
describe('Chat Controls', () => {
  // T17-1: Stop button visible during streaming
  it('shows stop button when streaming', () => {
    // Render ChatPanel in streaming state
    // Verify stop button is visible
    // Verify send button is hidden
  });

  // T17-2: Stop button hidden when idle
  it('hides stop button when not streaming', () => {
    // Render ChatPanel in ready state
    // Verify send button visible, stop button hidden
  });

  // T17-3: Stop preserves partial response
  it('preserves partial content when stopped', async () => {
    // Start streaming
    // Click stop after some tokens
    // Verify message has partial content and status 'canceled'
  });

  // T17-4: Regenerate re-sends last message
  it('re-sends last user message on regenerate', async () => {
    // Render with completed conversation
    // Click regenerate
    // Verify new POST to /api/chatbot/chat with same message text
  });

  // T17-5: Regenerate marks old response
  it('marks previous response as superseded', async () => {
    // After regeneration, the old assistant message shows "Regenerated" label
  });

  // T17-6: Cancel removes empty placeholder
  it('removes empty assistant message on early cancel', async () => {
    // Start streaming
    // Stop before any tokens arrive
    // Verify empty assistant message removed, user message remains
  });

  // T17-7: Escape triggers stop
  it('Escape key stops streaming', () => {
    // Render in streaming state
    // Press Escape
    // Verify stop was called
  });

  // T17-8: Stop does not affect other conversations
  it('stopping one conversation does not affect others', async () => {
    // Have two conversations active
    // Stop one
    // Verify the other continues streaming
  });

  // T17-9: Regenerate uses current project state
  it('regeneration may produce different answer after file changes', async () => {
    // This is more of an integration test
    // Regenerate sends a fresh request (new agent session with latest files)
  });
});
```
