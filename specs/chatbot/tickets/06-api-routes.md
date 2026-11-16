# Ticket 06: API Routes — Chat Endpoints

**Priority:** P0  
**Depends On:** Ticket 05  
**Requirements Ref:** Sections 5.1, 5.5, 8.2  
**Estimated Effort:** Medium  

## Description

Create the Next.js API routes for the chatbot. These routes live in `src/app/api/chatbot/` but delegate all logic to handler functions defined in `src/chatbot/api/handlers.ts`. The route files are thin wrappers — the business logic stays inside the chatbot module.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/chatbot/chat` | Send a message, get streamed response (SSE) |
| GET | `/api/chatbot/conversations` | List all conversations for current project |
| GET | `/api/chatbot/conversations/[id]` | Get a single conversation with all messages |
| DELETE | `/api/chatbot/conversations/[id]` | Delete a conversation |
| POST | `/api/chatbot/conversations/[id]/stop` | Stop an active streaming response |

## Files to Create

### `src/chatbot/api/handlers.ts`

Handler logic that the Next.js route files import:

```typescript
import { ChatbotService } from '../domain/ChatbotService';

export function createChatHandlers(chatbotService: ChatbotService) {
  return {
    // POST /api/chatbot/chat
    async chat(body: { conversationId?: string; message: string }, workspacePath: string) {
      // Validates input, calls chatbotService.chat(), returns ChatResponse
    },

    // GET /api/chatbot/conversations
    async listConversations(workspacePath: string) {
      // Returns { conversations: Conversation[] }
    },

    // GET /api/chatbot/conversations/:id
    async getConversation(id: string, workspacePath: string) {
      // Returns Conversation or 404
    },

    // DELETE /api/chatbot/conversations/:id
    async deleteConversation(id: string, workspacePath: string) {
      // Deletes and returns 204
    },

    // POST /api/chatbot/conversations/:id/stop
    async stopResponse(id: string, workspacePath: string) {
      // Stops active stream for conversation
    },
  };
}
```

### `src/app/api/chatbot/chat/route.ts`

```typescript
import { NextRequest } from 'next/server';
import { chatHandlers } from '../../../../adapters/chatbot-di'; // see Ticket 07
import { getWorkspacePath } from '../../../../adapters/primary/api/utils';
import { sseResponse } from '../../../../adapters/primary/api/sse';

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.message || typeof body.message !== 'string') {
    return Response.json({ error: 'message is required' }, { status: 400 });
  }
  const workspacePath = getWorkspacePath();
  return sseResponse(async (send) => {
    try {
      const response = await chatHandlers.chat(body, workspacePath);
      send('meta', { conversationId: response.conversationId });
      for await (const chunk of response.stream) {
        send('token', { text: chunk });
      }
      send('done', {});
    } catch (err: any) {
      send('error', { message: err?.message ?? String(err) });
    }
  });
}
```

### `src/app/api/chatbot/conversations/route.ts`

```typescript
// GET: list conversations
export async function GET() {
  const workspacePath = getWorkspacePath();
  const conversations = await chatHandlers.listConversations(workspacePath);
  return Response.json({ conversations });
}
```

### `src/app/api/chatbot/conversations/[id]/route.ts`

```typescript
// GET: single conversation
// DELETE: delete conversation
```

### `src/app/api/chatbot/conversations/[id]/stop/route.ts`

```typescript
// POST: stop active response
```

## Implementation Notes

- The SSE stream for `/api/chatbot/chat` sends three event types:
  - `meta` — first event, carries `{ conversationId }` so the UI knows which conversation to track
  - `token` — streaming text chunks `{ text: string }`
  - `done` — signals completion
  - `error` — signals error `{ message: string }`
- Input validation: `message` must be a non-empty string, `conversationId` is optional UUID
- `getWorkspacePath()` is the existing utility from the host app — the route files are the only place where chatbot code touches host utilities
- Error handling: 400 for bad input, 404 for not-found conversations, 500 for internal errors

## Acceptance Criteria

- [ ] All 5 endpoints created and functional
- [ ] `/api/chatbot/chat` streams SSE with meta/token/done/error events
- [ ] `/api/chatbot/conversations` returns sorted conversation list
- [ ] `/api/chatbot/conversations/[id]` returns full conversation or 404
- [ ] Delete endpoint stops any active response before deleting
- [ ] Stop endpoint stops streaming without deleting conversation
- [ ] Route files are thin wrappers — all logic in `src/chatbot/api/handlers.ts`
- [ ] Input validation returns 400 for bad requests

## Test Cases

### `src/chatbot/api/__tests__/handlers.test.ts`

```typescript
import { createChatHandlers } from '../handlers';
import { ChatbotService } from '../../domain/ChatbotService';

function mockChatbotService(): jest.Mocked<ChatbotService> {
  return {
    chat: jest.fn().mockResolvedValue({
      conversationId: 'conv-1',
      messageId: 'msg-1',
      stream: (async function* () { yield 'hello'; })(),
      stop: jest.fn(),
    }),
    getConversation: jest.fn().mockResolvedValue({
      id: 'conv-1', messages: [], projectPath: '/test',
      createdAt: '', updatedAt: '',
    }),
    listConversations: jest.fn().mockResolvedValue([]),
    deleteConversation: jest.fn().mockResolvedValue(undefined),
  } as any;
}

describe('Chat API Handlers', () => {
  // T06-1: Chat returns conversationId and stream
  it('chat() returns conversationId and iterable stream', async () => {
    const service = mockChatbotService();
    const handlers = createChatHandlers(service);
    const result = await handlers.chat({ message: 'Hello' }, '/test');
    expect(result.conversationId).toBe('conv-1');
    const chunks: string[] = [];
    for await (const c of result.stream) chunks.push(c);
    expect(chunks).toEqual(['hello']);
  });

  // T06-2: Chat validates message
  it('chat() throws on empty message', async () => {
    const handlers = createChatHandlers(mockChatbotService());
    await expect(handlers.chat({ message: '' }, '/test')).rejects.toThrow();
  });

  // T06-3: Chat validates message type
  it('chat() throws on non-string message', async () => {
    const handlers = createChatHandlers(mockChatbotService());
    await expect(handlers.chat({ message: 123 as any }, '/test')).rejects.toThrow();
  });

  // T06-4: List conversations delegates to service
  it('listConversations() returns conversations from service', async () => {
    const service = mockChatbotService();
    service.listConversations.mockResolvedValue([{ id: 'c1' } as any]);
    const handlers = createChatHandlers(service);
    const result = await handlers.listConversations('/test');
    expect(result).toHaveLength(1);
  });

  // T06-5: Get conversation returns 404 for missing
  it('getConversation() throws for non-existent conversation', async () => {
    const service = mockChatbotService();
    service.getConversation.mockResolvedValue(null);
    const handlers = createChatHandlers(service);
    await expect(handlers.getConversation('missing', '/test')).rejects.toThrow();
  });

  // T06-6: Delete delegates to service
  it('deleteConversation() calls service.deleteConversation', async () => {
    const service = mockChatbotService();
    const handlers = createChatHandlers(service);
    await handlers.deleteConversation('conv-1', '/test');
    expect(service.deleteConversation).toHaveBeenCalledWith('conv-1', '/test');
  });

  // T06-7: Chat with conversationId passes it through
  it('chat() passes conversationId to service', async () => {
    const service = mockChatbotService();
    const handlers = createChatHandlers(service);
    await handlers.chat({ conversationId: 'conv-1', message: 'Follow-up' }, '/test');
    expect(service.chat).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      message: 'Follow-up',
      projectPath: '/test',
    });
  });
});
```
