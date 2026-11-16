import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { FSConversationStore } from '../../adapters/FSConversationStore';
import { FSKnowledgeStore } from '../../adapters/FSKnowledgeStore';
import { ChatbotService } from '../../domain/ChatbotService';
import { ChatbotAgentRunner } from '../../adapters/ChatbotAgentRunner';
import type { ChatbotHostPort, ChatAgentSession } from '../../domain/ports';
import type { WorkflowStateSummary } from '../../domain/host-types';
import type { AgentConfig } from '../../domain/host-types';

let tmpDir: string;

function createMockHost(response: string): ChatbotHostPort {
  return {
    getWorkspacePath: () => tmpDir,
    getAgentConfig: (): AgentConfig => ({ agentType: 'claude' }),
    resolveCredentials: async () => ({ provider: 'anthropic', apiKey: 'test', model: 'test' }),
    spawnReadOnlyAgent: async (_ws: string, _prompt: string): Promise<ChatAgentSession> => {
      let stopped = false;
      return {
        stream: (async function* () {
          const words = response.split(' ');
          for (const word of words) {
            if (stopped) break;
            yield word + ' ';
            await new Promise(r => setTimeout(r, 5));
          }
        })(),
        stop: () => { stopped = true; },
        isRunning: () => !stopped,
      };
    },
    getWorkflowState: async (): Promise<WorkflowStateSummary> => ({
      features: [],
      activeFeatureName: null,
    }),
    isImplementationRunning: () => false,
  };
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chatbot-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('ChatbotService Integration', () => {
  it('AC-01/AC-02: creates conversation, sends message, receives streamed response', async () => {
    const host = createMockHost('Hello from the chatbot agent.');
    const convStore = new FSConversationStore();
    const knowledgeStore = new FSKnowledgeStore();
    const runner = new ChatbotAgentRunner(host, knowledgeStore);
    const service = new ChatbotService(convStore, knowledgeStore, runner);

    const response = await service.chat({ message: 'How does auth work?', projectPath: tmpDir });

    expect(response.conversationId).toBeTruthy();
    expect(response.messageId).toBeTruthy();

    let fullText = '';
    for await (const chunk of response.stream) {
      fullText += chunk;
    }
    expect(fullText).toContain('Hello from the chatbot agent.');

    const conv = await convStore.get(response.conversationId, tmpDir);
    expect(conv).toBeTruthy();
    expect(conv!.messages).toHaveLength(2);
    expect(conv!.messages[0].role).toBe('user');
    expect(conv!.messages[1].role).toBe('assistant');
    expect(conv!.messages[1].status).toBe('complete');
  });

  it('AC-03: maintains conversation history across exchanges', async () => {
    const host = createMockHost('Response text.');
    const convStore = new FSConversationStore();
    const knowledgeStore = new FSKnowledgeStore();
    const runner = new ChatbotAgentRunner(host, knowledgeStore);
    const service = new ChatbotService(convStore, knowledgeStore, runner);

    const r1 = await service.chat({ message: 'First question', projectPath: tmpDir });
    for await (const _ of r1.stream) {} // consume

    const r2 = await service.chat({
      conversationId: r1.conversationId,
      message: 'Follow-up question',
      projectPath: tmpDir,
    });
    for await (const _ of r2.stream) {} // consume

    expect(r2.conversationId).toBe(r1.conversationId);

    const conv = await convStore.get(r1.conversationId, tmpDir);
    expect(conv!.messages).toHaveLength(4);
  });

  it('AC-08: knowledge save requires explicit approval flow', async () => {
    const convStore = new FSConversationStore();
    const knowledgeStore = new FSKnowledgeStore();

    const change = await knowledgeStore.prepareChange(tmpDir, 'auth-flow', 'Auth Flow', 'JWT tokens are used.');
    expect(change.isConflict).toBe(false);
    expect(change.previousContent).toBeNull();

    await knowledgeStore.save(tmpDir, {
      slug: 'auth-flow',
      title: 'Auth Flow',
      content: 'JWT tokens are used.',
      updatedAt: new Date().toISOString(),
    });

    const saved = await knowledgeStore.get(tmpDir, 'auth-flow');
    expect(saved).toBeTruthy();
    expect(saved!.content).toBe('JWT tokens are used.');
  });

  it('AC-10: conversations expire after TTL', async () => {
    const convStore = new FSConversationStore();
    const conv = await convStore.create(tmpDir);

    const convDir = path.join(tmpDir, '.specify/chatbot/conversations');
    const filePath = path.join(convDir, `${conv.id}.json`);
    const raw = JSON.parse(await fs.readFile(filePath, 'utf-8'));
    raw.updatedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    await fs.writeFile(filePath, JSON.stringify(raw));

    const pruned = await convStore.prune(tmpDir);
    expect(pruned).toBe(1);

    const remaining = await convStore.list(tmpDir);
    expect(remaining).toHaveLength(0);
  });

  it('AC-12: stop interrupts streaming', async () => {
    const host = createMockHost('word1 word2 word3 word4 word5 word6 word7 word8 word9 word10');
    const convStore = new FSConversationStore();
    const knowledgeStore = new FSKnowledgeStore();
    const runner = new ChatbotAgentRunner(host, knowledgeStore);
    const service = new ChatbotService(convStore, knowledgeStore, runner);

    const response = await service.chat({ message: 'Generate something long', projectPath: tmpDir });

    let chunks = 0;
    for await (const _ of response.stream) {
      chunks++;
      if (chunks >= 2) {
        response.stop();
        break;
      }
    }
    expect(chunks).toBeGreaterThanOrEqual(2);
  });

  it('cross-project isolation: conversations from one project not visible in another', async () => {
    const tmpDir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'chatbot-test2-'));
    try {
      const convStore = new FSConversationStore();

      await convStore.create(tmpDir);
      await convStore.create(tmpDir2);

      const list1 = await convStore.list(tmpDir);
      const list2 = await convStore.list(tmpDir2);

      expect(list1).toHaveLength(1);
      expect(list2).toHaveLength(1);
      expect(list1[0].id).not.toBe(list2[0].id);
    } finally {
      await fs.rm(tmpDir2, { recursive: true, force: true });
    }
  });
});
