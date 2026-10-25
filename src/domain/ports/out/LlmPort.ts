import { LlmProvider } from '../../models/credentials';

export type LlmJsonRequest = {
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
};

export type LlmJsonResponse = {
  text: string; // raw model output (kept for debugging when validation fails)
  json: unknown; // parsed text
  model: string;
  inputTokens?: number;
  outputTokens?: number;
};

export type LlmErrorKind = 'auth' | 'rate_limit' | 'bad_request' | 'not_found' | 'refusal' | 'truncated' | 'invalid_json' | 'network' | 'unknown';

export class LlmError extends Error {
  constructor(public kind: LlmErrorKind, message: string, public raw?: string) {
    super(message);
  }
}

// One configured provider + key + model. Adapters translate the request into
// each provider's structured-output mode.
export interface LlmClient {
  readonly provider: LlmProvider;
  completeJson(req: LlmJsonRequest): Promise<LlmJsonResponse>;
  listModels(): Promise<string[]>;
}

export type LlmClientFactory = (provider: LlmProvider, apiKey: string, model: string) => LlmClient;
