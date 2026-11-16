# Ticket 16: Concurrent Implementation Awareness

**Priority:** P2  
**Depends On:** Ticket 05  
**Requirements Ref:** Sections 7.3, 8.2  
**Estimated Effort:** Small  

## Description

The chatbot must remain usable while Spec Rabbit implements, tests, or reviews features in parallel. When an implementation agent is actively modifying project files, the chatbot should:

1. **Warn the user** that files may be changing
2. **Qualify findings** that might be affected by in-progress changes
3. **Not disrupt** the implementation process

This ticket adds implementation-awareness to the chatbot's system prompt and UI.

## Implementation

### Detection: How to Know Implementation is Running

The host app tracks active agent sessions in the `agentSessions` map (see `di.ts:38`). The `ChatbotHostPort.isImplementationRunning()` method checks this map for any session tied to an implementation phase.

```typescript
// In SpecRabbitChatbotHost (chatbot-di.ts, Ticket 07):
isImplementationRunning(workspacePath: string): boolean {
  // Check agentSessions map for active implementation sessions
  for (const [key, session] of agentSessions) {
    if (key.startsWith(workspacePath) && !session.exited) {
      return true;
    }
  }
  return false;
}
```

### Agent Prompt (already in Ticket 04)

When `isImplementationRunning()` returns true, the agent prompt includes:
```
⚠️ An implementation task is currently running. Files may be changing.
Qualify findings that might be affected by concurrent modifications.
```

### UI Warning Banner

In `ChatPanel`, when implementation is running:
- Show a subtle amber banner above the input: "Implementation in progress — answers may reflect in-progress changes"
- Poll `/api/chatbot/status` every 10 seconds to check (or use the existing SSE state watcher)
- Remove banner when implementation finishes

### API Endpoint

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/chatbot/status` | Returns `{ implementationRunning: boolean, activeFeature?: string }` |

## Acceptance Criteria

- [ ] Chatbot detects when implementation is actively running
- [ ] Warning injected into agent prompt during active implementation
- [ ] UI shows amber banner during active implementation
- [ ] Banner removed when implementation finishes
- [ ] Chatbot responses qualify potentially affected findings
- [ ] Chatbot does not interfere with running implementation (AC: Section 7.3)

## Test Cases

### `src/chatbot/domain/__tests__/concurrent.test.ts`

```typescript
describe('Concurrent Implementation Awareness', () => {
  // T16-1: Detect running implementation
  it('detects when implementation is running', () => {
    const host = mockHost({ isImplementationRunning: () => true });
    expect(host.isImplementationRunning('/test')).toBe(true);
  });

  // T16-2: Detect idle state
  it('returns false when no implementation running', () => {
    const host = mockHost({ isImplementationRunning: () => false });
    expect(host.isImplementationRunning('/test')).toBe(false);
  });

  // T16-3: Agent prompt includes warning when running
  it('agent prompt includes concurrent warning', async () => {
    const host = mockHost({ isImplementationRunning: () => true });
    const runner = new ChatbotAgentRunner(host, mockKnowledgeStore());
    await runner.spawn('/test', 'question', '');
    const prompt = (host.spawnReadOnlyAgent as jest.Mock).mock.calls[0][1];
    expect(prompt).toContain('implementation task is currently running');
  });

  // T16-4: No warning when idle
  it('agent prompt omits warning when idle', async () => {
    const host = mockHost({ isImplementationRunning: () => false });
    const runner = new ChatbotAgentRunner(host, mockKnowledgeStore());
    await runner.spawn('/test', 'question', '');
    const prompt = (host.spawnReadOnlyAgent as jest.Mock).mock.calls[0][1];
    expect(prompt).not.toContain('implementation task');
  });

  // T16-5: Status endpoint returns state
  it('status endpoint reflects implementation state', async () => {
    // GET /api/chatbot/status returns { implementationRunning: true }
  });
});
```
