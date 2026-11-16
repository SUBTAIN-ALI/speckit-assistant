# Ticket 01: Foundation — Models, Types, Ports

**Priority:** P0  
**Depends On:** None  
**Requirements Ref:** Sections 1.3, 2.1, 3.1, 5.1, 8.2  
**Estimated Effort:** Small  

## Description

Create the foundational type definitions and port interface for the chatbot module. This ticket establishes the contract between the chatbot and the host Spec Rabbit application. All other chatbot tickets depend on these types.

The chatbot module (`src/chatbot/`) must import NOTHING from `src/domain/`, `src/components/`, or `src/adapters/`. It only depends on its own types and the `ChatbotHostPort` interface, which the host app implements.

## Files to Create

### `src/chatbot/domain/models.ts`

```typescript
// Conversation and message types
export type ChatRole = 'user' | 'assistant';

export type CitationSource = {
  type: 'file' | 'spec' | 'requirement' | 'review' | 'meeting' | 'knowledge' | 'git';
  path: string;           // file path or record identifier
  lineStart?: number;     // for file citations
  lineEnd?: number;
  snippet?: string;       // relevant excerpt
  label?: string;         // human-readable label ("specs/auth/spec.md:42")
};

export type MessageStatus = 'complete' | 'streaming' | 'canceled' | 'error';

export type ChatMessage = {
  id: string;             // uuid
  role: ChatRole;
  content: string;
  status: MessageStatus;
  citations?: CitationSource[];
  evidenceLabels?: EvidenceLabel[];
  createdAt: string;      // ISO 8601
};

export type EvidenceLabel = {
  type: 'code-fact' | 'spec-intent' | 'review-outcome' | 'general-knowledge' | 'uncertain';
  text: string;           // the labeled portion of the answer
};

export type Conversation = {
  id: string;             // uuid
  projectPath: string;    // absolute path of the project at creation time
  title?: string;         // derived from first user message or user-set
  messages: ChatMessage[];
  createdAt: string;      // ISO 8601
  updatedAt: string;      // ISO 8601
};

// Domain knowledge types
export type KnowledgeTopic = {
  slug: string;           // filename-safe identifier, e.g. "refund-policy"
  title: string;          // human-readable, e.g. "Refund Policy"
  content: string;        // Markdown body
  updatedAt: string;      // ISO 8601
};

export type KnowledgeChange = {
  slug: string;
  title: string;
  previousContent: string | null;  // null = new topic
  proposedContent: string;
  isConflict: boolean;             // true when proposed change conflicts with saved content
};

// Chat UI state
export type ChatState =
  | 'ready'
  | 'investigating'
  | 'files-changing'
  | 'insufficient-evidence'
  | 'knowledge-approval'
  | 'disconnected'
  | 'error'
  | 'agent-unavailable';
```

### `src/chatbot/domain/ports.ts`

```typescript
import { AgentConfig, WorkflowState } from './host-types';

// Re-export only the host types the chatbot needs — never import from src/domain/ directly.
// The host app maps its own types to these when implementing ChatbotHostPort.

export type ChatAgentSession = {
  stream: AsyncIterable<string>;
  stop: () => void;
  isRunning: () => boolean;
};

export interface ChatbotHostPort {
  // Project context
  getWorkspacePath(): string;
  getAgentConfig(): AgentConfig;
  
  // Credentials (for agent spawning)
  resolveCredentials(): Promise<{ provider: string; apiKey: string; model: string }>;
  
  // Agent session management
  spawnReadOnlyAgent(workspacePath: string, prompt: string): Promise<ChatAgentSession>;
  
  // Workflow state (read-only, for context)
  getWorkflowState(workspacePath: string): Promise<WorkflowState>;
  
  // Implementation status (for concurrent-activity warning)
  isImplementationRunning(workspacePath: string): boolean;
}
```

### `src/chatbot/domain/host-types.ts`

Minimal type re-declarations for the host types the chatbot needs. These mirror the relevant parts of `src/domain/models/types.ts` but are owned by the chatbot module to avoid importing from the host.

```typescript
// Subset of host types the chatbot needs — kept in sync manually.
// This avoids a direct import from src/domain/models/types.ts.

export type AgentType = 'claude' | 'gemini' | 'copilot' | 'openai' | 'custom';

export type AgentConfig = {
  agentType: AgentType;
  customCommand?: string;
  agentPath?: string;
  model?: string;
};

export type PhaseStatus = 'idle' | 'running' | 'awaiting_review' | 'approved' | 'skipped';

export type FeatureSummary = {
  name: string;
  phases: { phase: string; status: PhaseStatus }[];
};

export type WorkflowState = {
  features: FeatureSummary[];
  activeFeatureName: string | null;
};
```

### `src/chatbot/index.ts`

```typescript
// Public API for the chatbot module.
// The host app imports ONLY from this file.

export type { ChatbotHostPort, ChatAgentSession } from './domain/ports';
export type {
  Conversation,
  ChatMessage,
  ChatRole,
  MessageStatus,
  CitationSource,
  EvidenceLabel,
  KnowledgeTopic,
  KnowledgeChange,
  ChatState,
} from './domain/models';

// Service classes and components are exported here as they are built.
// (Added by subsequent tickets)
```

## Acceptance Criteria

- [ ] `src/chatbot/domain/models.ts` exists with all types above
- [ ] `src/chatbot/domain/ports.ts` exists with `ChatbotHostPort` interface
- [ ] `src/chatbot/domain/host-types.ts` exists with minimal host type mirrors
- [ ] `src/chatbot/index.ts` exists and re-exports all public types
- [ ] ZERO imports from `src/domain/`, `src/components/`, `src/adapters/` anywhere in `src/chatbot/`
- [ ] TypeScript compiles with no errors

## Test Cases

### T01-1: Type integrity
```
Given: All chatbot model types are defined
When: TypeScript compiler runs on src/chatbot/
Then: No type errors
```

### T01-2: No host imports
```
Given: src/chatbot/ folder exists
When: grep -r "from '.*src/domain\|from '.*src/adapters\|from '.*src/components" src/chatbot/
Then: Zero matches (no imports from host modules)
```

### T01-3: Public API completeness
```
Given: src/chatbot/index.ts exists
When: Another file imports { Conversation, ChatMessage, ChatbotHostPort } from 'src/chatbot'
Then: All types resolve correctly
```

### T01-4: Conversation type shape
```typescript
// src/chatbot/domain/__tests__/models.test.ts
import { Conversation, ChatMessage } from '../models';

describe('models', () => {
  it('Conversation has required fields', () => {
    const conv: Conversation = {
      id: 'abc-123',
      projectPath: '/home/user/my-project',
      messages: [],
      createdAt: '2026-11-16T00:00:00Z',
      updatedAt: '2026-11-16T00:00:00Z',
    };
    expect(conv.id).toBe('abc-123');
    expect(conv.messages).toEqual([]);
    expect(conv.title).toBeUndefined();
  });

  it('ChatMessage supports all statuses', () => {
    const statuses: ChatMessage['status'][] = ['complete', 'streaming', 'canceled', 'error'];
    for (const status of statuses) {
      const msg: ChatMessage = {
        id: '1',
        role: 'user',
        content: 'test',
        status,
        createdAt: '2026-11-16T00:00:00Z',
      };
      expect(msg.status).toBe(status);
    }
  });

  it('KnowledgeChange detects conflict', () => {
    const change: KnowledgeChange = {
      slug: 'refund-policy',
      title: 'Refund Policy',
      previousContent: 'Old rule',
      proposedContent: 'New rule',
      isConflict: true,
    };
    expect(change.isConflict).toBe(true);
    expect(change.previousContent).not.toBeNull();
  });
});
```

### T01-5: host-types stay minimal
```
Given: src/chatbot/domain/host-types.ts exists
When: Count the number of exported types
Then: ≤ 5 types (AgentType, AgentConfig, PhaseStatus, FeatureSummary, WorkflowState)
And: No business logic, only type declarations
```
