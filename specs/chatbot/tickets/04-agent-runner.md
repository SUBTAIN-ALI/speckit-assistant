# Ticket 04: Chatbot Agent Runner — Read-Only Wrapper

**Priority:** P0  
**Depends On:** Ticket 01  
**Requirements Ref:** Sections 5.1, 5.2, 5.3, 7.1, 7.2  
**Estimated Effort:** Medium  

## Description

Create a wrapper around the host app's agent runner that enforces read-only behavior for chatbot sessions. The chatbot uses the same AI CLI tool (Claude Code, Copilot, Gemini CLI) that the user has configured for their SDD workflows, but with strict constraints:

1. **Read-only system prompt** — the agent is instructed it cannot modify files, create tickets, or initiate implementation
2. **No write commands** — the agent session is configured to prevent file modifications
3. **Project-scoped** — the agent can only read files within the selected workspace
4. **Knowledge-aware** — the agent is pointed at `.specify/chatbot/knowledge/` for approved domain knowledge

This runner does NOT install a skill into the user's AI CLI. Spec Rabbit injects the read-only prompt as part of the agent session it spawns.

## Files to Create

### `src/chatbot/adapters/ChatbotAgentRunner.ts`

```typescript
import { ChatbotHostPort, ChatAgentSession } from '../domain/ports';
import { KnowledgeStore } from '../domain/KnowledgeStore';

const READ_ONLY_SYSTEM_PROMPT = `You are a read-only project understanding assistant for Spec Rabbit.

## Your Role
Answer the user's question about the selected project. You help users understand their project before making development decisions.

## Rules
- Answer ONLY the question asked. Do not append unrelated suggestions.
- You MUST NOT modify any files, create tickets, run implementations, or change any project state.
- You MUST NOT create, edit, or approve specifications, plans, or tasks.
- You CAN read source files, documentation, specs, plans, reviews, and domain knowledge.
- You CAN inspect git history when historical context is needed.
- You CAN explain general software/industry concepts, but MUST label them as "General Knowledge" distinct from project facts.

## Evidence Rules
- Distinguish clearly between:
  - **Code Facts**: What the inspected source code actually does
  - **Spec Intent**: What specifications or requirements say should happen
  - **Review Outcomes**: What review/test reports found
  - **General Knowledge**: Industry conventions or common patterns (always labeled)
  - **Uncertain**: When evidence is incomplete, say what was verified and what remains unknown
- Do not invent source files, endpoints, functions, or business rules.
- Do not claim a feature is absent merely because a bounded investigation didn't find it.
- When investigation limits are reached, return supported partial findings.

## Project Knowledge
The project has user-approved domain knowledge files in .specify/chatbot/knowledge/. Consult these when relevant but treat them as curated context, not code truth.

## Citation Format
When referencing project evidence, note the source:
- File: path and relevant line numbers
- Spec: feature name and section
- Git: commit hash and summary
- Knowledge: topic name
`;

export class ChatbotAgentRunner {
  constructor(
    private host: ChatbotHostPort,
    private knowledgeStore: KnowledgeStore,
  ) {}

  async spawn(workspacePath: string, userMessage: string, conversationHistory: string): Promise<ChatAgentSession> {
    const knowledgeTopics = await this.knowledgeStore.list(workspacePath);
    const knowledgeSummary = knowledgeTopics.length > 0
      ? `\n\nAvailable domain knowledge topics: ${knowledgeTopics.map(t => t.slug).join(', ')}`
      : '';

    const workflowState = await this.host.getWorkflowState(workspacePath);
    const featureSummary = workflowState.features.length > 0
      ? `\n\nProject features: ${workflowState.features.map(f => f.name).join(', ')}`
      : '';

    const implementationWarning = this.host.isImplementationRunning(workspacePath)
      ? '\n\n⚠️ An implementation task is currently running. Files may be changing. Qualify findings that might be affected.'
      : '';

    const fullPrompt = [
      READ_ONLY_SYSTEM_PROMPT,
      knowledgeSummary,
      featureSummary,
      implementationWarning,
      conversationHistory ? `\n\n## Prior Conversation\n${conversationHistory}` : '',
      `\n\n## Current Question\n${userMessage}`,
    ].join('');

    return this.host.spawnReadOnlyAgent(workspacePath, fullPrompt);
  }
}
```

## Implementation Notes

- The `spawnReadOnlyAgent` method on `ChatbotHostPort` is implemented by the host app in `di.ts`. It wraps the existing `ProcessAgentRunner` but:
  - Uses a flag/mode to indicate read-only (no file writes allowed)
  - Passes the chatbot system prompt as the initial instruction
  - Returns a `ChatAgentSession` with stream, stop, and isRunning capabilities
- Conversation history is passed as a compressed summary (not full messages) to stay within context limits. The caller (ChatbotService, Ticket 05) is responsible for formatting this.
- The `isImplementationRunning` check looks at whether any agent sessions are actively running for implementation phases.

## Host-Side Implementation Required (in di.ts, Ticket 07)

The host app must implement `spawnReadOnlyAgent()`. This is essentially:
```typescript
async spawnReadOnlyAgent(workspacePath: string, prompt: string): Promise<ChatAgentSession> {
  // Use the configured agent (Claude/Copilot/Gemini) in read-only mode
  // For Claude Code: spawn with --read-only or equivalent flag
  // For others: rely on system prompt enforcement
  const session = agentRunner.spawn(workspacePath, prompt, { readOnly: true });
  return {
    stream: session.output,
    stop: () => session.kill(),
    isRunning: () => session.isAlive(),
  };
}
```

## Acceptance Criteria

- [ ] `ChatbotAgentRunner` class created in `src/chatbot/adapters/`
- [ ] Read-only system prompt includes all evidence rules from the requirements doc
- [ ] Knowledge topics injected into prompt context
- [ ] Workflow state summary injected (feature names, active feature)
- [ ] Implementation-running warning injected when applicable
- [ ] Conversation history passed to agent for continuity
- [ ] No imports from host modules — only uses `ChatbotHostPort` interface

## Test Cases

### `src/chatbot/adapters/__tests__/ChatbotAgentRunner.test.ts`

```typescript
import { ChatbotAgentRunner } from '../ChatbotAgentRunner';
import { ChatbotHostPort, ChatAgentSession } from '../../domain/ports';
import { KnowledgeStore } from '../../domain/KnowledgeStore';
import { KnowledgeTopic } from '../../domain/models';

function mockHost(overrides: Partial<ChatbotHostPort> = {}): ChatbotHostPort {
  const session: ChatAgentSession = {
    stream: (async function* () { yield 'test response'; })(),
    stop: jest.fn(),
    isRunning: () => true,
  };
  return {
    getWorkspacePath: () => '/test/project',
    getAgentConfig: () => ({ agentType: 'claude' as const }),
    resolveCredentials: async () => ({ provider: 'anthropic', apiKey: 'key', model: 'claude' }),
    spawnReadOnlyAgent: jest.fn().mockResolvedValue(session),
    getWorkflowState: async () => ({ features: [], activeFeatureName: null }),
    isImplementationRunning: () => false,
    ...overrides,
  };
}

function mockKnowledgeStore(topics: KnowledgeTopic[] = []): KnowledgeStore {
  return {
    list: jest.fn().mockResolvedValue(topics),
    get: jest.fn().mockResolvedValue(null),
    prepareChange: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
    hasChanged: jest.fn().mockResolvedValue(false),
  };
}

describe('ChatbotAgentRunner', () => {
  // T04-1: Spawns agent with read-only prompt
  it('passes read-only system prompt to host', async () => {
    const host = mockHost();
    const runner = new ChatbotAgentRunner(host, mockKnowledgeStore());
    await runner.spawn('/test', 'What does auth do?', '');
    expect(host.spawnReadOnlyAgent).toHaveBeenCalledWith(
      '/test',
      expect.stringContaining('read-only project understanding assistant'),
    );
  });

  // T04-2: Prompt contains evidence rules
  it('includes evidence distinction rules in prompt', async () => {
    const host = mockHost();
    const runner = new ChatbotAgentRunner(host, mockKnowledgeStore());
    await runner.spawn('/test', 'question', '');
    const prompt = (host.spawnReadOnlyAgent as jest.Mock).mock.calls[0][1];
    expect(prompt).toContain('Code Facts');
    expect(prompt).toContain('Spec Intent');
    expect(prompt).toContain('General Knowledge');
    expect(prompt).toContain('Uncertain');
  });

  // T04-3: Knowledge topics injected
  it('injects knowledge topic names into prompt', async () => {
    const host = mockHost();
    const store = mockKnowledgeStore([
      { slug: 'refund-policy', title: 'Refund Policy', content: '', updatedAt: '' },
      { slug: 'auth-rules', title: 'Auth Rules', content: '', updatedAt: '' },
    ]);
    const runner = new ChatbotAgentRunner(host, store);
    await runner.spawn('/test', 'question', '');
    const prompt = (host.spawnReadOnlyAgent as jest.Mock).mock.calls[0][1];
    expect(prompt).toContain('refund-policy');
    expect(prompt).toContain('auth-rules');
  });

  // T04-4: Feature names injected
  it('injects project feature names into prompt', async () => {
    const host = mockHost({
      getWorkflowState: async () => ({
        features: [
          { name: 'user-auth', phases: [] },
          { name: 'payments', phases: [] },
        ],
        activeFeatureName: 'user-auth',
      }),
    });
    const runner = new ChatbotAgentRunner(host, mockKnowledgeStore());
    await runner.spawn('/test', 'question', '');
    const prompt = (host.spawnReadOnlyAgent as jest.Mock).mock.calls[0][1];
    expect(prompt).toContain('user-auth');
    expect(prompt).toContain('payments');
  });

  // T04-5: Implementation warning when running
  it('includes warning when implementation is running', async () => {
    const host = mockHost({ isImplementationRunning: () => true });
    const runner = new ChatbotAgentRunner(host, mockKnowledgeStore());
    await runner.spawn('/test', 'question', '');
    const prompt = (host.spawnReadOnlyAgent as jest.Mock).mock.calls[0][1];
    expect(prompt).toContain('implementation task is currently running');
  });

  // T04-6: No warning when implementation is idle
  it('omits implementation warning when nothing is running', async () => {
    const host = mockHost({ isImplementationRunning: () => false });
    const runner = new ChatbotAgentRunner(host, mockKnowledgeStore());
    await runner.spawn('/test', 'question', '');
    const prompt = (host.spawnReadOnlyAgent as jest.Mock).mock.calls[0][1];
    expect(prompt).not.toContain('implementation task is currently running');
  });

  // T04-7: Conversation history included
  it('includes conversation history when provided', async () => {
    const host = mockHost();
    const runner = new ChatbotAgentRunner(host, mockKnowledgeStore());
    await runner.spawn('/test', 'follow-up question', 'User: How does auth work?\nAssistant: It uses JWT tokens.');
    const prompt = (host.spawnReadOnlyAgent as jest.Mock).mock.calls[0][1];
    expect(prompt).toContain('Prior Conversation');
    expect(prompt).toContain('JWT tokens');
  });

  // T04-8: Returns session with stream/stop/isRunning
  it('returns a ChatAgentSession', async () => {
    const host = mockHost();
    const runner = new ChatbotAgentRunner(host, mockKnowledgeStore());
    const session = await runner.spawn('/test', 'question', '');
    expect(session.stream).toBeDefined();
    expect(typeof session.stop).toBe('function');
    expect(typeof session.isRunning).toBe('function');
  });

  // T04-9: Prompt tells agent not to modify files
  it('prompt explicitly forbids file modification', async () => {
    const host = mockHost();
    const runner = new ChatbotAgentRunner(host, mockKnowledgeStore());
    await runner.spawn('/test', 'question', '');
    const prompt = (host.spawnReadOnlyAgent as jest.Mock).mock.calls[0][1];
    expect(prompt).toContain('MUST NOT modify any files');
    expect(prompt).toContain('MUST NOT create, edit, or approve specifications');
  });
});
```
