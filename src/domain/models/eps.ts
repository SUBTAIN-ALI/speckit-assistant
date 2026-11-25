export const EPS_ENDPOINTS = {
  staging: 'https://stagingapi.coastlineeps.com/mcp',
  production: 'https://prodapi.coastlineeps.com/mcp',
} as const;
export type EpsEnvironment = keyof typeof EPS_ENDPOINTS;
export const EPS_STAGES = ['requirement', 'spec', 'plan_review', 'ai_dev', 'uat', 'prod'] as const;
export type EpsStage = typeof EPS_STAGES[number];
export const EPS_CHECKS = ['unit_regression', 'soc2', 'pci', 'anti_pattern', 'code_reuse', 'docs', 'uat_acceptance'] as const;
export type EpsRequirement = {
  id: string; title: string; businessOutcome: string; acceptanceCriteria: string[];
  stage: EpsStage; released: boolean; updatedAt: string;
  velocity?: string | null; sdlcManifest?: Record<string, unknown>; compliance?: Record<string, boolean>;
};
export type EpsMessage = {
  id: string; requirementId: string; author: 'dev' | 'business';
  type: 'update' | 'question' | 'answer'; body: string; createdAt: string;
};
export type EpsBinding = {
  requirement: EpsRequirement; setId: string; localId: string;
  messages: EpsMessage[]; cursor?: string; appliedAnswers: string[];
  waitingForAnswer?: boolean; lastReport?: string; conflict?: string; unavailable?: boolean; feature?: string;
};
export type EpsWrite = {
  id: string; requirementId: string; tool: 'update_status' | 'set_compliance' | 'post_message';
  args: Record<string, unknown>; state: 'pending' | 'sending' | 'uncertain' | 'failed';
  attempts: number; nextAttempt: number; error?: string;
  automatic?: boolean;
};
export type EpsState = {
  environment: EpsEnvironment; enabled: boolean; bindings: EpsBinding[]; outbox: EpsWrite[];
  lastSync?: string; error?: string; authBlocked?: boolean;
};
export const emptyEpsState = (): EpsState => ({ environment: 'staging', enabled: false, bindings: [], outbox: [] });
export class EpsError extends Error {
  constructor(message: string, public kind: 'auth' | 'transport' | 'protocol' | 'tool' | 'validation' = 'validation') { super(message); }
}
