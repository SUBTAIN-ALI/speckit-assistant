import { AgentConfig, WorkflowStateSummary } from './host-types';

export type ChatAgentSession = {
  stream: AsyncIterable<string>;
  stop: () => void;
  isRunning: () => boolean;
};

export interface ChatbotHostPort {
  getWorkspacePath(): string;
  getAgentConfig(): AgentConfig;
  resolveCredentials(): Promise<{ provider: string; apiKey: string; model: string }>;
  spawnReadOnlyAgent(workspacePath: string, prompt: string, onData?: (text: string) => void): Promise<ChatAgentSession>;
  getWorkflowState(workspacePath: string): Promise<WorkflowStateSummary>;
  isImplementationRunning(workspacePath: string): boolean;
}
