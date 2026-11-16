# Ticket 07: DI Wiring — Host Port Implementation + Registration

**Priority:** P0  
**Depends On:** Ticket 06  
**Requirements Ref:** Sections 5.1, 5.3  
**Estimated Effort:** Medium  

## Description

Wire the chatbot module into the host Spec Rabbit application. This is the **only** place where host-app code and chatbot code connect. The host implements `ChatbotHostPort`, instantiates the chatbot services, and exports the chat handlers for the API routes.

This ticket also removes the old direct-API `ChatService` and its route, replacing them entirely with the new chatbot module.

## Files to Create

### `src/adapters/chatbot-di.ts`

This file is the bridge. It lives in the HOST's adapters directory (not inside `src/chatbot/`).

```typescript
import { ChatbotHostPort, ChatAgentSession } from '../chatbot';
import { ChatbotAgentRunner } from '../chatbot/adapters/ChatbotAgentRunner';
import { FSConversationStore } from '../chatbot/adapters/FSConversationStore';
import { FSKnowledgeStore } from '../chatbot/adapters/FSKnowledgeStore';
import { ChatbotService } from '../chatbot/domain/ChatbotService';
import { createChatHandlers } from '../chatbot/api/handlers';
import { workflowService, agentRunner, integrationsService } from './di';
// ... other host imports as needed

class SpecRabbitChatbotHost implements ChatbotHostPort {
  getWorkspacePath(): string {
    // Delegate to host's workspace path resolution
    return getWorkspacePathFromCookie(); // or however it's currently resolved
  }

  getAgentConfig() {
    // Read from host's agent configuration
    return agentRepository.getDefault();
  }

  async resolveCredentials() {
    return integrationsService.resolveKey();
  }

  async spawnReadOnlyAgent(workspacePath: string, prompt: string): Promise<ChatAgentSession> {
    // Use the host's ProcessAgentRunner in read-only mode
    const session = agentRunner.run(workspacePath, prompt, { readOnly: true });
    return {
      stream: session.stdout,
      stop: () => session.kill(),
      isRunning: () => !session.exited,
    };
  }

  async getWorkflowState(workspacePath: string) {
    const state = await workflowService.getState(workspacePath);
    return {
      features: state.features.map(f => ({
        name: f.name,
        phases: f.phases.map(p => ({ phase: p.phase, status: p.status })),
      })),
      activeFeatureName: state.activeFeatureName,
    };
  }

  isImplementationRunning(workspacePath: string): boolean {
    // Check if any agent sessions are running for implementation phases
    return workflowService.isPhaseRunning(workspacePath, 'implementation');
  }
}

// Instantiate chatbot services
const chatbotHost = new SpecRabbitChatbotHost();
const conversationStore = new FSConversationStore();
const knowledgeStore = new FSKnowledgeStore();
const chatbotAgentRunner = new ChatbotAgentRunner(chatbotHost, knowledgeStore);
const chatbotService = new ChatbotService(conversationStore, knowledgeStore, chatbotAgentRunner);

export const chatHandlers = createChatHandlers(chatbotService);
export { chatbotService, knowledgeStore };
```

## Files to Modify

### `src/adapters/di.ts`

- Remove `chatService` export (old direct-API chat)
- Remove `ChatService` import
- Remove `createChatLlmClient` import (no longer needed for chat)
- Keep all other exports unchanged

### `src/app/api/chat/route.ts`

- Delete this file entirely (replaced by `src/app/api/chatbot/chat/route.ts`)

### Host-side additions needed

The host's `ProcessAgentRunner` may need a `readOnly` option. Verify:
- Does it already support a mode where the agent can't write files?
- If not, add a `readOnly` flag that configures the agent CLI with read-only constraints
- For Claude Code: use `--read-only` flag or equivalent
- For Copilot/Gemini: rely on system prompt enforcement (the read-only prompt from Ticket 04)

## Implementation Notes

- `SpecRabbitChatbotHost` maps the host's internal types to the chatbot's `host-types.ts` shapes — the chatbot never sees `PhaseState`, `PersonaState`, etc.
- The `spawnReadOnlyAgent` implementation depends on how `ProcessAgentRunner` works. Review `src/adapters/secondary/agent/ProcessAgentRunner.ts` and adapt. The key requirement: the spawned agent session streams stdout and can be killed.
- `isImplementationRunning` needs to check the `agentSessions` map (see `di.ts` line 38) for any active implementation sessions.
- The old `src/domain/services/chat/` directory and its files (`ChatService.ts`, `ProjectContextCollector.ts`) should be deleted after migration.

## Acceptance Criteria

- [ ] `src/adapters/chatbot-di.ts` created, implementing `ChatbotHostPort`
- [ ] `chatHandlers` exported and usable by API routes
- [ ] Old `chatService` removed from `di.ts`
- [ ] Old `/api/chat/route.ts` deleted
- [ ] Old `src/domain/services/chat/` directory deleted
- [ ] `ProcessAgentRunner` supports read-only mode (or documented workaround)
- [ ] Host types correctly mapped to chatbot's `host-types.ts` shapes
- [ ] No circular imports between host and chatbot modules

## Test Cases

### `src/adapters/__tests__/chatbot-di.test.ts`

```typescript
describe('SpecRabbitChatbotHost', () => {
  // T07-1: Host implements all ChatbotHostPort methods
  it('implements ChatbotHostPort interface completely', () => {
    // Verify the host class has all required methods
    const host = new SpecRabbitChatbotHost();
    expect(typeof host.getWorkspacePath).toBe('function');
    expect(typeof host.getAgentConfig).toBe('function');
    expect(typeof host.resolveCredentials).toBe('function');
    expect(typeof host.spawnReadOnlyAgent).toBe('function');
    expect(typeof host.getWorkflowState).toBe('function');
    expect(typeof host.isImplementationRunning).toBe('function');
  });

  // T07-2: getWorkflowState maps host types to chatbot types
  it('maps host WorkflowState to chatbot FeatureSummary[]', async () => {
    const host = new SpecRabbitChatbotHost();
    const state = await host.getWorkflowState('/test/project');
    // Should have features array with name and simplified phases
    expect(Array.isArray(state.features)).toBe(true);
    if (state.features.length > 0) {
      expect(state.features[0]).toHaveProperty('name');
      expect(state.features[0]).toHaveProperty('phases');
      // Should NOT have full PhaseState properties like filePath, content, personas
      expect(state.features[0].phases[0]).not.toHaveProperty('filePath');
      expect(state.features[0].phases[0]).not.toHaveProperty('content');
    }
  });

  // T07-3: spawnReadOnlyAgent returns ChatAgentSession
  it('spawnReadOnlyAgent returns stream, stop, isRunning', async () => {
    const host = new SpecRabbitChatbotHost();
    const session = await host.spawnReadOnlyAgent('/test', 'Read project and explain auth');
    expect(session.stream).toBeDefined();
    expect(typeof session.stop).toBe('function');
    expect(typeof session.isRunning).toBe('function');
  });

  // T07-4: Old chat route no longer exists
  it('old /api/chat route is removed', () => {
    const fs = require('fs');
    expect(fs.existsSync('src/app/api/chat/route.ts')).toBe(false);
  });

  // T07-5: Old ChatService is removed
  it('old src/domain/services/chat/ is removed', () => {
    const fs = require('fs');
    expect(fs.existsSync('src/domain/services/chat')).toBe(false);
  });

  // T07-6: No circular imports
  it('chatbot module does not import from src/domain/', () => {
    // Run: grep -r "from '.*src/domain" src/chatbot/ — should return nothing
    const { execSync } = require('child_process');
    const result = execSync(
      "grep -r \"from '.*src/domain\\|from '.*src/adapters\\|from '.*src/components\" src/chatbot/ || true",
      { encoding: 'utf-8' }
    );
    expect(result.trim()).toBe('');
  });
});
```
