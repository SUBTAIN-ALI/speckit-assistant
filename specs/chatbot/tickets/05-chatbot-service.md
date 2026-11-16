# Ticket 05: Chatbot Service — Q&A Orchestration

**Priority:** P0  
**Depends On:** Tickets 02, 03, 04  
**Requirements Ref:** Sections 3.1, 3.2, 3.3, 5.4, 5.5, 6.1, 6.2  
**Estimated Effort:** Large  

## Description

The central orchestration service for the chatbot. `ChatbotService` receives a user question, manages the conversation lifecycle, spawns a read-only agent session, streams the response, and persists everything. It is the single entry point called by the API route.

This service coordinates:
- Conversation creation and retrieval
- History formatting for agent context
- Agent session spawning via `ChatbotAgentRunner`
- Response streaming back to the caller
- Message persistence (user message + streaming assistant response)
- Concurrent request management (one active response per conversation)

## Files to Create

### `src/chatbot/domain/ChatbotService.ts`

```typescript
import { ConversationStore } from './ConversationStore';
import { KnowledgeStore } from './KnowledgeStore';
import { ChatbotAgentRunner } from '../adapters/ChatbotAgentRunner';
import { Conversation, ChatMessage } from './models';

export type ChatRequest = {
  conversationId?: string;   // existing conversation, or omit for new
  message: string;           // user's question
  projectPath: string;
};

export type ChatResponse = {
  conversationId: string;
  messageId: string;         // the assistant message ID (for updateLastMessage)
  stream: AsyncIterable<string>;
  stop: () => void;
};

export class ChatbotService {
  // Track active responses to prevent concurrent responses in same conversation
  private activeResponses = new Map<string, { stop: () => void }>();

  constructor(
    private conversationStore: ConversationStore,
    private knowledgeStore: KnowledgeStore,
    private agentRunner: ChatbotAgentRunner,
  ) {}

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const { message, projectPath } = request;

    // 1. Get or create conversation
    let conversation: Conversation;
    if (request.conversationId) {
      const existing = await this.conversationStore.get(request.conversationId, projectPath);
      if (!existing) throw new Error('Conversation not found or expired');
      conversation = existing;
    } else {
      conversation = await this.conversationStore.create(projectPath);
    }

    // 2. Prevent concurrent responses in same conversation
    const existing = this.activeResponses.get(conversation.id);
    if (existing) {
      existing.stop();
      this.activeResponses.delete(conversation.id);
    }

    // 3. Persist user message
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: message,
      status: 'complete',
      createdAt: new Date().toISOString(),
    };
    await this.conversationStore.appendMessage(conversation.id, projectPath, userMessage);

    // 4. Create placeholder assistant message (streaming)
    const assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      status: 'streaming',
      createdAt: new Date().toISOString(),
    };
    await this.conversationStore.appendMessage(conversation.id, projectPath, assistantMessage);

    // 5. Format conversation history for agent context
    const history = this.formatHistory(conversation.messages);

    // 6. Spawn agent
    const session = await this.agentRunner.spawn(projectPath, message, history);

    // 7. Track active response
    this.activeResponses.set(conversation.id, { stop: session.stop });

    // 8. Create wrapped stream that persists as it goes
    const self = this;
    const persistentStream = (async function* () {
      let accumulated = '';
      try {
        for await (const chunk of session.stream) {
          accumulated += chunk;
          yield chunk;
        }
        // Finalize: persist complete message
        await self.conversationStore.updateLastMessage(conversation.id, projectPath, {
          content: accumulated,
          status: 'complete',
        });
      } catch (err) {
        await self.conversationStore.updateLastMessage(conversation.id, projectPath, {
          content: accumulated || 'An error occurred while generating the response.',
          status: accumulated ? 'complete' : 'error',
        });
        throw err;
      } finally {
        self.activeResponses.delete(conversation.id);
      }
    })();

    return {
      conversationId: conversation.id,
      messageId: assistantMessage.id,
      stream: persistentStream,
      stop: () => {
        session.stop();
        // Mark as canceled (best-effort — the stream's finally block handles cleanup)
        self.conversationStore.updateLastMessage(conversation.id, projectPath, {
          status: 'canceled',
        }).catch(() => {});
        self.activeResponses.delete(conversation.id);
      },
    };
  }

  // Get conversation history for display
  async getConversation(conversationId: string, projectPath: string): Promise<Conversation | null> {
    return this.conversationStore.get(conversationId, projectPath);
  }

  // List all conversations (triggers TTL prune)
  async listConversations(projectPath: string): Promise<Conversation[]> {
    return this.conversationStore.list(projectPath);
  }

  // Delete a conversation
  async deleteConversation(conversationId: string, projectPath: string): Promise<void> {
    const active = this.activeResponses.get(conversationId);
    if (active) {
      active.stop();
      this.activeResponses.delete(conversationId);
    }
    return this.conversationStore.delete(conversationId, projectPath);
  }

  // Format message history as compressed text for agent context window
  private formatHistory(messages: ChatMessage[]): string {
    if (messages.length === 0) return '';
    // Keep last N exchanges to fit context. Each exchange = user + assistant.
    const MAX_EXCHANGES = 10;
    const MAX_CHARS = 8000;
    const recent = messages.slice(-(MAX_EXCHANGES * 2));
    let result = '';
    for (const msg of recent) {
      const prefix = msg.role === 'user' ? 'User' : 'Assistant';
      const content = msg.content.length > 500
        ? msg.content.slice(0, 500) + '... [truncated]'
        : msg.content;
      result += `${prefix}: ${content}\n\n`;
      if (result.length > MAX_CHARS) break;
    }
    return result.trim();
  }
}
```

## Implementation Notes

- `formatHistory()` compresses conversation to fit within agent context limits. Last 10 exchanges, each message truncated to 500 chars, total capped at 8000 chars. These are reasonable defaults; exact limits depend on the AI CLI's context window.
- The `persistentStream` wraps the agent's stream to persist the response incrementally. The actual persistence happens on completion (not per-chunk) to avoid excessive I/O.
- `stop()` marks the message as `canceled` — the UI should display it as "Response interrupted."
- Concurrent response prevention: if a new question arrives while one is streaming, the old one is stopped.
- The service is stateless except for the `activeResponses` map (in-memory only, clears on restart).

## Acceptance Criteria

- [ ] `ChatbotService` created with `chat()`, `getConversation()`, `listConversations()`, `deleteConversation()`
- [ ] `chat()` creates new conversation or continues existing one
- [ ] User message persisted before agent spawns
- [ ] Assistant message persisted as streaming, updated to complete/canceled/error
- [ ] Concurrent response in same conversation: old one stopped, new one starts
- [ ] History formatted and passed to agent (capped at 10 exchanges / 8000 chars)
- [ ] `stop()` on response marks message as canceled
- [ ] Stream errors handled: message saved with error status or partial content

## Test Cases

### `src/chatbot/domain/__tests__/ChatbotService.test.ts`

```typescript
import { ChatbotService } from '../ChatbotService';
import { ConversationStore } from '../ConversationStore';
import { KnowledgeStore } from '../KnowledgeStore';
import { ChatbotAgentRunner } from '../../adapters/ChatbotAgentRunner';
import { Conversation, ChatMessage } from '../models';

// Helpers
function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-1',
    projectPath: '/test',
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function mockConversationStore(): jest.Mocked<ConversationStore> {
  const conv = makeConversation();
  return {
    create: jest.fn().mockResolvedValue(conv),
    get: jest.fn().mockResolvedValue(conv),
    list: jest.fn().mockResolvedValue([conv]),
    appendMessage: jest.fn().mockResolvedValue(undefined),
    updateLastMessage: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    prune: jest.fn().mockResolvedValue(0),
  };
}

function mockAgentRunner(chunks: string[] = ['Hello', ' world']): jest.Mocked<ChatbotAgentRunner> {
  return {
    spawn: jest.fn().mockResolvedValue({
      stream: (async function* () { for (const c of chunks) yield c; })(),
      stop: jest.fn(),
      isRunning: () => true,
    }),
  } as any;
}

function mockKnowledgeStore(): jest.Mocked<KnowledgeStore> {
  return {
    list: jest.fn().mockResolvedValue([]),
    get: jest.fn().mockResolvedValue(null),
    prepareChange: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
    hasChanged: jest.fn().mockResolvedValue(false),
  };
}

describe('ChatbotService', () => {
  // T05-1: New conversation created when no conversationId
  it('creates a new conversation for first message', async () => {
    const store = mockConversationStore();
    const service = new ChatbotService(store, mockKnowledgeStore(), mockAgentRunner());
    const response = await service.chat({ message: 'Hello', projectPath: '/test' });
    expect(store.create).toHaveBeenCalledWith('/test');
    expect(response.conversationId).toBe('conv-1');
  });

  // T05-2: Existing conversation continued
  it('continues existing conversation', async () => {
    const store = mockConversationStore();
    const service = new ChatbotService(store, mockKnowledgeStore(), mockAgentRunner());
    await service.chat({ conversationId: 'conv-1', message: 'Follow-up', projectPath: '/test' });
    expect(store.get).toHaveBeenCalledWith('conv-1', '/test');
    expect(store.create).not.toHaveBeenCalled();
  });

  // T05-3: Throws for expired/non-existent conversation
  it('throws when conversation not found', async () => {
    const store = mockConversationStore();
    store.get.mockResolvedValue(null);
    const service = new ChatbotService(store, mockKnowledgeStore(), mockAgentRunner());
    await expect(service.chat({ conversationId: 'gone', message: 'Hi', projectPath: '/test' }))
      .rejects.toThrow('Conversation not found or expired');
  });

  // T05-4: User message persisted before agent spawns
  it('persists user message before spawning agent', async () => {
    const store = mockConversationStore();
    const runner = mockAgentRunner();
    const service = new ChatbotService(store, mockKnowledgeStore(), runner);
    await service.chat({ message: 'What does auth do?', projectPath: '/test' });
    
    // appendMessage called before spawn (user message first, then assistant placeholder)
    expect(store.appendMessage).toHaveBeenCalledTimes(2);
    const firstCall = store.appendMessage.mock.calls[0];
    expect(firstCall[2].role).toBe('user');
    expect(firstCall[2].content).toBe('What does auth do?');
  });

  // T05-5: Stream yields agent chunks
  it('streams agent response chunks', async () => {
    const service = new ChatbotService(
      mockConversationStore(), mockKnowledgeStore(), mockAgentRunner(['chunk1', 'chunk2'])
    );
    const response = await service.chat({ message: 'Hi', projectPath: '/test' });
    const chunks: string[] = [];
    for await (const chunk of response.stream) chunks.push(chunk);
    expect(chunks).toEqual(['chunk1', 'chunk2']);
  });

  // T05-6: Message finalized as complete after stream ends
  it('marks message as complete when stream finishes', async () => {
    const store = mockConversationStore();
    const service = new ChatbotService(store, mockKnowledgeStore(), mockAgentRunner(['done']));
    const response = await service.chat({ message: 'Hi', projectPath: '/test' });
    for await (const _ of response.stream) {} // consume stream
    expect(store.updateLastMessage).toHaveBeenCalledWith('conv-1', '/test', {
      content: 'done',
      status: 'complete',
    });
  });

  // T05-7: Stop marks message as canceled
  it('marks message as canceled on stop()', async () => {
    const store = mockConversationStore();
    const runner = mockAgentRunner();
    // Make stream that hangs forever
    runner.spawn.mockResolvedValue({
      stream: (async function* () { await new Promise(() => {}); })(),
      stop: jest.fn(),
      isRunning: () => true,
    });
    const service = new ChatbotService(store, mockKnowledgeStore(), runner);
    const response = await service.chat({ message: 'Hi', projectPath: '/test' });
    response.stop();
    // Give async operations time to settle
    await new Promise(r => setTimeout(r, 50));
    expect(store.updateLastMessage).toHaveBeenCalledWith('conv-1', '/test', { status: 'canceled' });
  });

  // T05-8: Concurrent response in same conversation stops previous
  it('stops previous response when new one starts in same conversation', async () => {
    const store = mockConversationStore();
    const stopFn = jest.fn();
    const runner = mockAgentRunner();
    runner.spawn.mockResolvedValue({
      stream: (async function* () { await new Promise(() => {}); })(),
      stop: stopFn,
      isRunning: () => true,
    });
    const service = new ChatbotService(store, mockKnowledgeStore(), runner);
    await service.chat({ conversationId: 'conv-1', message: 'Q1', projectPath: '/test' });
    
    // Reset mock for second call
    runner.spawn.mockResolvedValue({
      stream: (async function* () { yield 'answer'; })(),
      stop: jest.fn(),
      isRunning: () => true,
    });
    await service.chat({ conversationId: 'conv-1', message: 'Q2', projectPath: '/test' });
    expect(stopFn).toHaveBeenCalled();
  });

  // T05-9: History formatting caps at 10 exchanges
  it('formats history with max 10 exchanges', async () => {
    const messages: ChatMessage[] = [];
    for (let i = 0; i < 30; i++) {
      messages.push({
        id: `m${i}`, role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`, status: 'complete', createdAt: new Date().toISOString(),
      });
    }
    const store = mockConversationStore();
    store.get.mockResolvedValue(makeConversation({ messages }));
    const runner = mockAgentRunner();
    const service = new ChatbotService(store, mockKnowledgeStore(), runner);
    await service.chat({ conversationId: 'conv-1', message: 'New Q', projectPath: '/test' });
    const prompt = runner.spawn.mock.calls[0][2]; // history arg
    // Should not contain early messages
    expect(prompt).not.toContain('Message 0');
    // Should contain recent messages
    expect(prompt).toContain('Message 29');
  });

  // T05-10: Delete conversation stops active response
  it('stops active response when conversation is deleted', async () => {
    const store = mockConversationStore();
    const stopFn = jest.fn();
    const runner = mockAgentRunner();
    runner.spawn.mockResolvedValue({
      stream: (async function* () { await new Promise(() => {}); })(),
      stop: stopFn,
      isRunning: () => true,
    });
    const service = new ChatbotService(store, mockKnowledgeStore(), runner);
    await service.chat({ conversationId: 'conv-1', message: 'Q', projectPath: '/test' });
    await service.deleteConversation('conv-1', '/test');
    expect(stopFn).toHaveBeenCalled();
    expect(store.delete).toHaveBeenCalledWith('conv-1', '/test');
  });

  // T05-11: List conversations delegates to store
  it('lists conversations from store', async () => {
    const store = mockConversationStore();
    const service = new ChatbotService(store, mockKnowledgeStore(), mockAgentRunner());
    const list = await service.listConversations('/test');
    expect(store.list).toHaveBeenCalledWith('/test');
    expect(list).toHaveLength(1);
  });
});
```
