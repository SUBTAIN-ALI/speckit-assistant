import { AgentConfig, AgentType } from './types';

// A persisted, user-managed agent profile. Superset of AgentConfig with an
// identity, a display name, and the MCP servers assigned to it.
export type AgentProfile = {
  id: string;
  name: string;
  agentType: AgentType;
  agentPath?: string;
  customCommand?: string;
  model?: string;
  mcpServerIds?: string[]; // ids of McpServer assigned to this agent
  enabled?: boolean;
  description?: string;
};

export type AgentsFile = {
  agents: AgentProfile[];
  activeAgentId?: string | null;
};

export const DEFAULT_AGENTS: AgentsFile = {
  agents: [
    {
      id: 'codex-default',
      name: 'Codex (Default)',
      agentType: 'openai',
      model: 'gpt-6-sol',
      enabled: true,
      mcpServerIds: [],
      description: 'Default OpenAI Codex CLI agent.',
    },
    {
      id: 'claude-default',
      name: 'Claude',
      agentType: 'claude',
      model: 'claude-sonnet-4-6',
      enabled: true,
      mcpServerIds: [],
      description: 'Anthropic Claude CLI agent.',
    },
  ],
  activeAgentId: 'codex-default',
};

// Reduce a profile to the AgentConfig the runner/phase API consumes.
export function toAgentConfig(p: AgentProfile): AgentConfig {
  return {
    agentType: p.agentType,
    agentPath: p.agentPath || undefined,
    customCommand: p.customCommand || undefined,
    model: p.model || undefined,
  };
}

// Resolve the active profile (falls back to the first agent, then nothing).
export function activeAgent(file: AgentsFile): AgentProfile | null {
  if (file.agents.length === 0) return null;
  return file.agents.find(a => a.id === file.activeAgentId) || file.agents[0];
}
