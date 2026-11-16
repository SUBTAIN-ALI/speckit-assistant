import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ChatbotAgentRunner } from '../ChatbotAgentRunner';
import type { ChatbotHostPort, ChatAgentSession } from '../../domain/ports';
import type { WorkflowStateSummary, AgentConfig } from '../../domain/host-types';
import { FSKnowledgeStore } from '../FSKnowledgeStore';

let tmpDir: string;
let capturedPrompt: string;

function createCapturingHost(hasGit: boolean): ChatbotHostPort {
  if (hasGit) {
    fs.mkdirSync(path.join(tmpDir, '.git'), { recursive: true });
  }
  return {
    getWorkspacePath: () => tmpDir,
    getAgentConfig: (): AgentConfig => ({ agentType: 'claude' }),
    resolveCredentials: async () => ({ provider: 'anthropic', apiKey: 'test', model: 'test' }),
    spawnReadOnlyAgent: async (_ws: string, prompt: string): Promise<ChatAgentSession> => {
      capturedPrompt = prompt;
      return {
        stream: (async function* () { yield 'ok'; })(),
        stop: () => {},
        isRunning: () => false,
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
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'chatbot-git-test-'));
  capturedPrompt = '';
});

afterEach(async () => {
  await fsp.rm(tmpDir, { recursive: true, force: true });
});

describe('ChatbotAgentRunner Git History Integration', () => {
  it('system prompt allows read-only git commands', async () => {
    const host = createCapturingHost(true);
    const knowledgeStore = new FSKnowledgeStore();
    const runner = new ChatbotAgentRunner(host, knowledgeStore);

    await runner.spawn(tmpDir, 'What changed recently?', '');

    expect(capturedPrompt).toContain('git log');
    expect(capturedPrompt).toContain('git show');
    expect(capturedPrompt).toContain('git diff');
    expect(capturedPrompt).toContain('git blame');
    expect(capturedPrompt).toContain('git shortlog');
  });

  it('system prompt forbids state-modifying git commands', async () => {
    const host = createCapturingHost(true);
    const knowledgeStore = new FSKnowledgeStore();
    const runner = new ChatbotAgentRunner(host, knowledgeStore);

    await runner.spawn(tmpDir, 'Change something', '');

    expect(capturedPrompt).toContain('MUST NOT run git commands that modify state');
    expect(capturedPrompt).toContain('git commit');
    expect(capturedPrompt).toContain('git push');
    expect(capturedPrompt).toContain('git reset');
    expect(capturedPrompt).toContain('git checkout');
  });

  it('instructs agent to use git only for historical questions', async () => {
    const host = createCapturingHost(true);
    const knowledgeStore = new FSKnowledgeStore();
    const runner = new ChatbotAgentRunner(host, knowledgeStore);

    await runner.spawn(tmpDir, 'How does auth work?', '');

    expect(capturedPrompt).toContain('Use git history ONLY when the question asks about past changes');
    expect(capturedPrompt).toContain('For ordinary');
    expect(capturedPrompt).toContain('inspect current files');
  });

  it('warns non-git projects to skip git commands', async () => {
    const host = createCapturingHost(false);
    const knowledgeStore = new FSKnowledgeStore();
    const runner = new ChatbotAgentRunner(host, knowledgeStore);

    await runner.spawn(tmpDir, 'Show me history', '');

    expect(capturedPrompt).toContain('no git history');
    expect(capturedPrompt).toContain('Do not attempt git commands');
  });

  it('does not warn about git for projects with .git', async () => {
    const host = createCapturingHost(true);
    const knowledgeStore = new FSKnowledgeStore();
    const runner = new ChatbotAgentRunner(host, knowledgeStore);

    await runner.spawn(tmpDir, 'Show me history', '');

    expect(capturedPrompt).not.toContain('no git history');
    expect(capturedPrompt).not.toContain('Do not attempt git commands');
  });

  it('includes implementation warning when implementation is running', async () => {
    const host = createCapturingHost(true);
    (host as any).isImplementationRunning = () => true;
    const knowledgeStore = new FSKnowledgeStore();
    const runner = new ChatbotAgentRunner(host, knowledgeStore);

    await runner.spawn(tmpDir, 'What does index.ts do?', '');

    expect(capturedPrompt).toContain('implementation task is currently running');
    expect(capturedPrompt).toContain('Files may be changing');
  });

  it('includes conversation history in prompt', async () => {
    const host = createCapturingHost(true);
    const knowledgeStore = new FSKnowledgeStore();
    const runner = new ChatbotAgentRunner(host, knowledgeStore);

    await runner.spawn(tmpDir, 'Follow-up question', 'User: First question\n\nAssistant: First answer');

    expect(capturedPrompt).toContain('## Prior Conversation');
    expect(capturedPrompt).toContain('First question');
    expect(capturedPrompt).toContain('## Current Question');
    expect(capturedPrompt).toContain('Follow-up question');
  });

  it('includes knowledge topics when available', async () => {
    const host = createCapturingHost(true);
    const knowledgeStore = new FSKnowledgeStore();

    await knowledgeStore.save(tmpDir, {
      slug: 'auth-flow',
      title: 'Auth Flow',
      content: 'JWT tokens are used.',
      updatedAt: new Date().toISOString(),
    });

    const runner = new ChatbotAgentRunner(host, knowledgeStore);
    await runner.spawn(tmpDir, 'How does auth work?', '');

    expect(capturedPrompt).toContain('Available domain knowledge topics');
    expect(capturedPrompt).toContain('auth-flow');
  });
});
