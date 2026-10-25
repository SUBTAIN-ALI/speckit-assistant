import {
  DEFAULT_LLM_MODELS,
  IntegrationCredentials,
  IntegrationsView,
  LLM_ENV_VARS,
  LLM_PROVIDERS,
  LlmProvider,
  ZOOM_CALLBACK_PATH,
  isLlmProvider,
  keyHint,
} from '../models/credentials';
import { CredentialStorePort } from '../ports/out/CredentialStorePort';
import { LlmClient, LlmClientFactory } from '../ports/out/LlmPort';

// Settings for the user's own AI keys and Zoom app. Secrets go in, only
// presence/hints come out (see IntegrationsView).

export type IntegrationsUpdate = {
  llm?: {
    provider?: LlmProvider;
    // A string sets the key, null removes it, omitted leaves it unchanged.
    keys?: Partial<Record<LlmProvider, string | null>>;
    models?: Partial<Record<LlmProvider, string>>;
  };
  zoom?: {
    clientId?: string | null;
    clientSecret?: string | null;
    callbackUrl?: string | null;
  };
};

export class NotConfiguredError extends Error {}

// Accepts "https://abc.ngrok.app" or the full callback URL; returns the full
// callback URL. Zoom only accepts public HTTPS redirect URLs.
export function normalizeCallbackUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error('The callback URL must be a full https:// URL, e.g. https://your-name.ngrok.app');
  }
  if (url.protocol !== 'https:') throw new Error('The callback URL must start with https:// (Zoom rejects http and local addresses).');
  if (url.pathname === '/' || url.pathname === '') url.pathname = ZOOM_CALLBACK_PATH;
  if (url.pathname.replace(/\/$/, '') !== ZOOM_CALLBACK_PATH) {
    throw new Error(`The callback URL must end with ${ZOOM_CALLBACK_PATH}`);
  }
  return `${url.origin}${ZOOM_CALLBACK_PATH}`;
}

export class IntegrationsService {
  constructor(
    private store: CredentialStorePort,
    private llmFactory: LlmClientFactory,
    private env: Record<string, string | undefined> = process.env
  ) {}

  private envKey(provider: LlmProvider): string | undefined {
    for (const name of LLM_ENV_VARS[provider]) {
      const v = this.env[name];
      if (v && v.trim()) return v.trim();
    }
    return undefined;
  }

  private keyFor(creds: IntegrationCredentials, provider: LlmProvider): string | undefined {
    return creds.llm?.keys?.[provider] || this.envKey(provider);
  }

  private modelFor(creds: IntegrationCredentials, provider: LlmProvider): string {
    return creds.llm?.models?.[provider] || DEFAULT_LLM_MODELS[provider];
  }

  // Provider to use when none is saved: the first one with a key, else OpenAI.
  private activeProvider(creds: IntegrationCredentials): LlmProvider {
    if (creds.llm?.provider) return creds.llm.provider;
    return LLM_PROVIDERS.find(p => this.keyFor(creds, p)) ?? 'openai';
  }

  async getView(): Promise<IntegrationsView> {
    const creds = await this.store.load();
    const configured = {} as Record<LlmProvider, boolean>;
    const models = {} as Record<LlmProvider, string>;
    const keyHints: Partial<Record<LlmProvider, string>> = {};
    const envKey: Partial<Record<LlmProvider, boolean>> = {};
    for (const p of LLM_PROVIDERS) {
      const saved = creds.llm?.keys?.[p];
      configured[p] = !!this.keyFor(creds, p);
      models[p] = this.modelFor(creds, p);
      if (saved) keyHints[p] = keyHint(saved);
      else if (this.envKey(p)) envKey[p] = true;
    }
    const z = creds.zoom ?? {};
    return {
      llm: { provider: this.activeProvider(creds), models, configured, keyHints, envKey },
      zoom: {
        clientId: z.clientId,
        hasClientSecret: !!z.clientSecret,
        callbackUrl: z.callbackUrl,
        connected: !!z.tokens,
        account: z.account,
      },
    };
  }

  async update(patch: IntegrationsUpdate): Promise<IntegrationsView> {
    const creds = await this.store.load();
    const next: IntegrationCredentials = { ...creds };

    if (patch.llm) {
      const llm = {
        provider: this.activeProvider(creds),
        keys: { ...(creds.llm?.keys ?? {}) },
        models: { ...(creds.llm?.models ?? {}) },
      };
      if (patch.llm.provider !== undefined) {
        if (!isLlmProvider(patch.llm.provider)) throw new Error(`Unknown AI provider: ${String(patch.llm.provider)}`);
        llm.provider = patch.llm.provider;
      }
      for (const [p, v] of Object.entries(patch.llm.keys ?? {})) {
        if (!isLlmProvider(p)) continue;
        if (v === null) delete llm.keys[p];
        else if (typeof v === 'string' && v.trim()) llm.keys[p] = v.trim();
      }
      for (const [p, v] of Object.entries(patch.llm.models ?? {})) {
        if (!isLlmProvider(p) || typeof v !== 'string') continue;
        if (v.trim()) llm.models[p] = v.trim();
        else delete llm.models[p];
      }
      next.llm = llm;
    }

    if (patch.zoom) {
      const zoom = { ...(creds.zoom ?? {}) };
      const { clientId, clientSecret, callbackUrl } = patch.zoom;
      if (callbackUrl === null || (typeof callbackUrl === 'string' && !callbackUrl.trim())) delete zoom.callbackUrl;
      else if (typeof callbackUrl === 'string') zoom.callbackUrl = normalizeCallbackUrl(callbackUrl);
      const idChanged = clientId !== undefined && (clientId?.trim() || undefined) !== zoom.clientId;
      if (clientId === null) delete zoom.clientId;
      else if (typeof clientId === 'string' && clientId.trim()) zoom.clientId = clientId.trim();
      if (clientSecret === null) delete zoom.clientSecret;
      else if (typeof clientSecret === 'string' && clientSecret.trim()) zoom.clientSecret = clientSecret.trim();
      // Tokens belong to the old app; a different app means signing in again.
      if (idChanged) {
        delete zoom.tokens;
        delete zoom.account;
        delete zoom.pendingAuth;
      }
      next.zoom = zoom;
    }

    await this.store.save(next);
    return this.getView();
  }

  // The configured client for the active (or given) provider.
  async resolveLlm(provider?: LlmProvider): Promise<{ client: LlmClient; provider: LlmProvider; model: string }> {
    const creds = await this.store.load();
    const p = provider ?? this.activeProvider(creds);
    const key = this.keyFor(creds, p);
    if (!key) throw new NotConfiguredError(`Add an API key for ${p === 'openai' ? 'OpenAI' : p === 'anthropic' ? 'Anthropic' : 'Google Gemini'} in Settings first.`);
    const model = this.modelFor(creds, p);
    return { client: this.llmFactory(p, key, model), provider: p, model };
  }

  // Lists a provider's models, with a key typed into the form (not yet saved) or the stored one.
  async listModels(provider: LlmProvider, apiKey?: string): Promise<string[]> {
    const creds = await this.store.load();
    const key = apiKey?.trim() || this.keyFor(creds, provider);
    if (!key) throw new NotConfiguredError('Enter an API key first.');
    return this.llmFactory(provider, key, this.modelFor(creds, provider)).listModels();
  }
}
