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

export type WorkflowStateSummary = {
  features: FeatureSummary[];
  activeFeatureName: string | null;
};
