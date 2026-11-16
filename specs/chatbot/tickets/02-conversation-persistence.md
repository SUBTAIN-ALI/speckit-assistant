# Ticket 02: Conversation Persistence + 7-Day TTL

**Priority:** P0  
**Depends On:** Ticket 01  
**Requirements Ref:** Sections 3.3, 3.4, 5.4, 7.4, 8.2  
**Estimated Effort:** Medium  

## Description

Implement durable, file-based conversation storage inside the user's project. Conversations are JSON files stored in `.specify/chatbot/conversations/`. Each conversation is tied to one project. Conversations older than 7 days are automatically pruned when the conversation list is loaded.

Conversation history is independent of the AI CLI's session storage. It survives app restarts, AI tool changes, and Spec Rabbit re-opens. Prior answers are preserved as historical responses — never silently rewritten.

## Files to Create

### `src/chatbot/domain/ConversationStore.ts`

Interface definition:

```typescript
import { Conversation, ChatMessage } from './models';

export interface ConversationStore {
  // Create a new conversation for the current project
  create(projectPath: string): Promise<Conversation>;
  
  // Get a conversation by ID (returns null if not found or expired)
  get(id: string, projectPath: string): Promise<Conversation | null>;
  
  // List all conversations for a project (most recent first), after pruning expired ones
  list(projectPath: string): Promise<Conversation[]>;
  
  // Append a message to a conversation
  appendMessage(conversationId: string, projectPath: string, message: ChatMessage): Promise<void>;
  
  // Update the last message (for streaming: update content as tokens arrive)
  updateLastMessage(conversationId: string, projectPath: string, update: Partial<ChatMessage>): Promise<void>;
  
  // Delete a specific conversation
  delete(conversationId: string, projectPath: string): Promise<void>;
  
  // Remove all conversations older than 7 days. Called internally by list().
  prune(projectPath: string): Promise<number>; // returns count of pruned conversations
}
```

### `src/chatbot/adapters/FSConversationStore.ts`

File-based implementation:

- Storage path: `<projectPath>/.specify/chatbot/conversations/<uuid>.json`
- Each file is a serialized `Conversation` object
- `list()` reads the directory, parses each JSON, filters by TTL, sorts by `updatedAt` descending
- `prune()` deletes files where `updatedAt` is > 7 days ago
- `list()` calls `prune()` before returning results
- `appendMessage()` reads the file, pushes the message, writes back
- `updateLastMessage()` reads the file, updates the last message's fields, writes back
- File writes must be atomic: write to `.tmp` then rename (avoids corruption on crash)
- Directory is created on first write if it doesn't exist

**JSON file format:**
```json
{
  "id": "a1b2c3d4-...",
  "projectPath": "/Users/dev/my-project",
  "title": "How are refunds handled?",
  "messages": [
    {
      "id": "msg-001",
      "role": "user",
      "content": "How are refunds handled in this project?",
      "status": "complete",
      "createdAt": "2026-11-16T10:30:00Z"
    },
    {
      "id": "msg-002",
      "role": "assistant",
      "content": "Based on the inspection of...",
      "status": "complete",
      "citations": [...],
      "createdAt": "2026-11-16T10:30:15Z"
    }
  ],
  "createdAt": "2026-11-16T10:30:00Z",
  "updatedAt": "2026-11-16T10:30:15Z"
}
```

## Implementation Notes

- Use `crypto.randomUUID()` for conversation and message IDs
- Title is auto-derived: first 80 characters of the first user message, trimmed to last complete word
- `updatedAt` is set on every `appendMessage` / `updateLastMessage` call
- The 7-day TTL is based on `updatedAt`, not `createdAt` — active conversations stay alive
- File path safety: validate that projectPath is the actual workspace (don't allow path traversal in conversation ID)
- All file I/O uses `fs/promises` for async (this is a new module, no legacy sync patterns)

## Acceptance Criteria

- [ ] `ConversationStore` interface defined in `src/chatbot/domain/ConversationStore.ts`
- [ ] `FSConversationStore` implements the interface using JSON files in `.specify/chatbot/conversations/`
- [ ] Conversations auto-pruned after 7 days (based on `updatedAt`)
- [ ] `list()` returns conversations sorted by `updatedAt` descending
- [ ] File writes are atomic (write-to-tmp + rename)
- [ ] Title auto-derived from first user message
- [ ] No imports from host modules (`src/domain/`, `src/adapters/`, `src/components/`)

## Test Cases

### `src/chatbot/adapters/__tests__/FSConversationStore.test.ts`

```typescript
import { FSConversationStore } from '../FSConversationStore';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('FSConversationStore', () => {
  let tmpDir: string;
  let store: FSConversationStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chatbot-test-'));
    store = new FSConversationStore();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // T02-1: Create conversation
  it('creates a conversation with a UUID and empty messages', async () => {
    const conv = await store.create(tmpDir);
    expect(conv.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(conv.messages).toEqual([]);
    expect(conv.projectPath).toBe(tmpDir);
    expect(conv.createdAt).toBeDefined();
  });

  // T02-2: Persist to disk
  it('persists conversation as JSON file', async () => {
    const conv = await store.create(tmpDir);
    const filePath = path.join(tmpDir, '.specify', 'chatbot', 'conversations', `${conv.id}.json`);
    const stat = await fs.stat(filePath);
    expect(stat.isFile()).toBe(true);
  });

  // T02-3: Append message
  it('appends a message and updates updatedAt', async () => {
    const conv = await store.create(tmpDir);
    await store.appendMessage(conv.id, tmpDir, {
      id: 'msg-1',
      role: 'user',
      content: 'What does this project do?',
      status: 'complete',
      createdAt: new Date().toISOString(),
    });
    const loaded = await store.get(conv.id, tmpDir);
    expect(loaded!.messages).toHaveLength(1);
    expect(loaded!.messages[0].content).toBe('What does this project do?');
    expect(loaded!.updatedAt).not.toBe(conv.updatedAt);
  });

  // T02-4: Auto-title from first user message
  it('sets title from first user message', async () => {
    const conv = await store.create(tmpDir);
    await store.appendMessage(conv.id, tmpDir, {
      id: 'msg-1',
      role: 'user',
      content: 'How are refunds approved in this project?',
      status: 'complete',
      createdAt: new Date().toISOString(),
    });
    const loaded = await store.get(conv.id, tmpDir);
    expect(loaded!.title).toBe('How are refunds approved in this project?');
  });

  // T02-5: Title truncation at 80 chars
  it('truncates title to 80 characters on last complete word', async () => {
    const conv = await store.create(tmpDir);
    const longMsg = 'a '.repeat(50); // 100 chars
    await store.appendMessage(conv.id, tmpDir, {
      id: 'msg-1', role: 'user', content: longMsg, status: 'complete',
      createdAt: new Date().toISOString(),
    });
    const loaded = await store.get(conv.id, tmpDir);
    expect(loaded!.title!.length).toBeLessThanOrEqual(80);
    expect(loaded!.title!.endsWith('...')).toBeFalsy(); // clean word break
  });

  // T02-6: List returns sorted by updatedAt desc
  it('lists conversations most recent first', async () => {
    const c1 = await store.create(tmpDir);
    await store.appendMessage(c1.id, tmpDir, {
      id: 'm1', role: 'user', content: 'First', status: 'complete',
      createdAt: new Date().toISOString(),
    });
    // Small delay to ensure different updatedAt
    await new Promise(r => setTimeout(r, 50));
    const c2 = await store.create(tmpDir);
    await store.appendMessage(c2.id, tmpDir, {
      id: 'm2', role: 'user', content: 'Second', status: 'complete',
      createdAt: new Date().toISOString(),
    });
    const list = await store.list(tmpDir);
    expect(list[0].id).toBe(c2.id);
    expect(list[1].id).toBe(c1.id);
  });

  // T02-7: 7-day TTL pruning
  it('prunes conversations older than 7 days', async () => {
    const conv = await store.create(tmpDir);
    // Manually backdate the file
    const filePath = path.join(tmpDir, '.specify', 'chatbot', 'conversations', `${conv.id}.json`);
    const data = JSON.parse(await fs.readFile(filePath, 'utf-8'));
    data.updatedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    await fs.writeFile(filePath, JSON.stringify(data));

    const pruned = await store.prune(tmpDir);
    expect(pruned).toBe(1);
    const loaded = await store.get(conv.id, tmpDir);
    expect(loaded).toBeNull();
  });

  // T02-8: Active conversation not pruned
  it('does not prune conversations updated within 7 days', async () => {
    const conv = await store.create(tmpDir);
    await store.appendMessage(conv.id, tmpDir, {
      id: 'm1', role: 'user', content: 'Recent', status: 'complete',
      createdAt: new Date().toISOString(),
    });
    const pruned = await store.prune(tmpDir);
    expect(pruned).toBe(0);
    const list = await store.list(tmpDir);
    expect(list).toHaveLength(1);
  });

  // T02-9: Update last message (streaming support)
  it('updates the last message content', async () => {
    const conv = await store.create(tmpDir);
    await store.appendMessage(conv.id, tmpDir, {
      id: 'msg-a', role: 'assistant', content: '', status: 'streaming',
      createdAt: new Date().toISOString(),
    });
    await store.updateLastMessage(conv.id, tmpDir, {
      content: 'Here is the answer...',
      status: 'complete',
    });
    const loaded = await store.get(conv.id, tmpDir);
    expect(loaded!.messages[0].content).toBe('Here is the answer...');
    expect(loaded!.messages[0].status).toBe('complete');
  });

  // T02-10: Delete conversation
  it('deletes a specific conversation', async () => {
    const conv = await store.create(tmpDir);
    await store.delete(conv.id, tmpDir);
    const loaded = await store.get(conv.id, tmpDir);
    expect(loaded).toBeNull();
  });

  // T02-11: Non-existent conversation returns null
  it('returns null for non-existent conversation', async () => {
    const loaded = await store.get('non-existent-id', tmpDir);
    expect(loaded).toBeNull();
  });

  // T02-12: Atomic writes survive crash simulation
  it('does not corrupt file on partial write', async () => {
    const conv = await store.create(tmpDir);
    await store.appendMessage(conv.id, tmpDir, {
      id: 'm1', role: 'user', content: 'Test', status: 'complete',
      createdAt: new Date().toISOString(),
    });
    // Verify no .tmp files left behind
    const dir = path.join(tmpDir, '.specify', 'chatbot', 'conversations');
    const files = await fs.readdir(dir);
    expect(files.every(f => f.endsWith('.json'))).toBe(true);
  });

  // T02-13: Empty project has no conversations
  it('returns empty list for project with no conversations', async () => {
    const list = await store.list(tmpDir);
    expect(list).toEqual([]);
  });

  // T02-14: list() triggers prune
  it('prunes expired conversations when listing', async () => {
    const conv = await store.create(tmpDir);
    const filePath = path.join(tmpDir, '.specify', 'chatbot', 'conversations', `${conv.id}.json`);
    const data = JSON.parse(await fs.readFile(filePath, 'utf-8'));
    data.updatedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    await fs.writeFile(filePath, JSON.stringify(data));

    const list = await store.list(tmpDir);
    expect(list).toHaveLength(0);
  });
});
```
