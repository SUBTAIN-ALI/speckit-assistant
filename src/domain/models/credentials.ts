// User-provided secrets for the meeting → requirements feature. Stored only in
// ~/.speckit-assistant/credentials.json (mode 0600), never in the workspace, and
// never returned to the browser — the UI only sees IntegrationsView.

// Path of the OAuth redirect handler (src/app/api/integrations/zoom/callback).
export const ZOOM_CALLBACK_PATH = '/api/integrations/zoom/callback';

export const LLM_PROVIDERS = ['openai', 'anthropic', 'google'] as const;
export type LlmProvider = typeof LLM_PROVIDERS[number];

export const LLM_PROVIDER_LABELS: Record<LlmProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
  google: 'Google (Gemini)',
};

// Suggested defaults; the settings screen can list each provider's live models.
export const DEFAULT_LLM_MODELS: Record<LlmProvider, string> = {
  openai: 'gpt-5',
  anthropic: 'claude-opus-5-5',
  google: 'gemini-2.5-flash',
};

export type LlmSettings = {
  provider: LlmProvider;
  keys: Partial<Record<LlmProvider, string>>;
  models: Partial<Record<LlmProvider, string>>;
};

export type ZoomTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
  scope?: string;
};

export type ZoomSettings = {
  clientId?: string;
  clientSecret?: string;
  // Public HTTPS URL (e.g. an ngrok tunnel) that forwards to this app's Zoom
  // callback. Zoom rejects local redirect URLs, so sign-in needs one of these.
  callbackUrl?: string;
  tokens?: ZoomTokens;
  account?: { name?: string; email?: string };
  // In-flight OAuth attempt (PKCE verifier + CSRF state), cleared on callback.
  // returnOrigin is where the user started, so the callback can send them back there.
  pendingAuth?: { state: string; verifier: string; redirectUri: string; createdAt: number; returnOrigin?: string };
};

export type IntegrationCredentials = {
  llm?: LlmSettings;
  zoom?: ZoomSettings;
};

// What the browser is allowed to see: which secrets exist, never their values.
export type IntegrationsView = {
  llm: {
    provider: LlmProvider;
    models: Record<LlmProvider, string>;
    configured: Record<LlmProvider, boolean>;
    keyHints: Partial<Record<LlmProvider, string>>; // "…a1b2"
    envKey: Partial<Record<LlmProvider, boolean>>;  // key comes from an env var
  };
  zoom: {
    clientId?: string; // client ids are not secret
    hasClientSecret: boolean;
    callbackUrl?: string;
    connected: boolean;
    account?: { name?: string; email?: string };
  };
};

// Standard env vars each SDK reads, honored when no key is saved.
export const LLM_ENV_VARS: Record<LlmProvider, string[]> = {
  openai: ['OPENAI_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
  google: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
};

export function isLlmProvider(v: unknown): v is LlmProvider {
  return typeof v === 'string' && (LLM_PROVIDERS as readonly string[]).includes(v);
}

export function keyHint(secret: string | undefined): string | undefined {
  if (!secret) return undefined;
  return secret.length <= 8 ? '…' : `…${secret.slice(-4)}`;
}
