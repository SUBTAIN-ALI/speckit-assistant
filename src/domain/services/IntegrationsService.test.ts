import { describe, it, expect } from 'vitest';
import { IntegrationsService, NotConfiguredError, normalizeCallbackUrl } from './IntegrationsService';
import { MemoryCredentials, ScriptedLlm } from '../../test/meetingFakes';
import { LlmProvider } from '../models/credentials';

const factoryCalls: Array<{ provider: LlmProvider; key: string; model: string }> = [];
const factory = (provider: LlmProvider, key: string, model: string) => {
  factoryCalls.push({ provider, key, model });
  return new ScriptedLlm(provider, [], [`${provider}-model-a`]);
};

describe('IntegrationsService', () => {
  it('never exposes secrets in the view', async () => {
    const store = new MemoryCredentials();
    const svc = new IntegrationsService(store, factory, {});
    const view = await svc.update({
      llm: { provider: 'anthropic', keys: { anthropic: 'sk-ant-supersecret-1234' } },
      zoom: { clientId: 'cid', clientSecret: 'zoom-secret-value' },
    });
    const json = JSON.stringify(view);
    expect(json).not.toContain('supersecret');
    expect(json).not.toContain('zoom-secret-value');
    expect(view.llm).toMatchObject({ provider: 'anthropic', configured: { anthropic: true, openai: false, google: false }, keyHints: { anthropic: '…1234' } });
    expect(view.zoom).toEqual({ clientId: 'cid', hasClientSecret: true, connected: false, account: undefined });
    // ...but they are stored.
    expect(store.data.llm?.keys.anthropic).toBe('sk-ant-supersecret-1234');
  });

  it('defaults to the first provider with a key, then OpenAI', async () => {
    expect((await new IntegrationsService(new MemoryCredentials(), factory, {}).getView()).llm.provider).toBe('openai');
    const svc = new IntegrationsService(new MemoryCredentials({ llm: { provider: undefined as never, keys: { google: 'g-key-123456' }, models: {} } }), factory, {});
    expect((await svc.getView()).llm.provider).toBe('google');
  });

  it('uses env keys when none are saved, and reports them', async () => {
    const svc = new IntegrationsService(new MemoryCredentials(), factory, { OPENAI_API_KEY: 'env-openai-key' });
    const view = await svc.getView();
    expect(view.llm.configured.openai).toBe(true);
    expect(view.llm.envKey.openai).toBe(true);
    expect(view.llm.keyHints.openai).toBeUndefined();
    const { provider, model } = await svc.resolveLlm();
    expect(provider).toBe('openai');
    expect(model).toBe('gpt-5');
    expect(factoryCalls.at(-1)).toMatchObject({ provider: 'openai', key: 'env-openai-key' });
  });

  it('removes keys with null, ignores blanks, and overrides models', async () => {
    const svc = new IntegrationsService(new MemoryCredentials(), factory, {});
    await svc.update({ llm: { keys: { openai: 'sk-1234567890' }, models: { openai: 'gpt-x' } } });
    await svc.update({ llm: { keys: { openai: '   ' } } });
    expect((await svc.getView()).llm.configured.openai).toBe(true);
    expect((await svc.getView()).llm.models.openai).toBe('gpt-x');
    await svc.update({ llm: { keys: { openai: null }, models: { openai: '' } } });
    const view = await svc.getView();
    expect(view.llm.configured.openai).toBe(false);
    expect(view.llm.models.openai).toBe('gpt-5');
  });

  it('rejects an unknown provider', async () => {
    const svc = new IntegrationsService(new MemoryCredentials(), factory, {});
    await expect(svc.update({ llm: { provider: 'mistral' as never } })).rejects.toThrow(/Unknown AI provider/);
  });

  it('throws NotConfiguredError without a key', async () => {
    const svc = new IntegrationsService(new MemoryCredentials(), factory, {});
    await expect(svc.resolveLlm('anthropic')).rejects.toBeInstanceOf(NotConfiguredError);
    await expect(svc.listModels('google')).rejects.toBeInstanceOf(NotConfiguredError);
  });

  it('lists models with an unsaved key from the form', async () => {
    const svc = new IntegrationsService(new MemoryCredentials(), factory, {});
    expect(await svc.listModels('google', 'typed-key')).toEqual(['google-model-a']);
    expect(factoryCalls.at(-1)).toMatchObject({ provider: 'google', key: 'typed-key' });
  });

  it('drops Zoom tokens when the client id changes', async () => {
    const store = new MemoryCredentials({ zoom: { clientId: 'old', clientSecret: 's', tokens: { accessToken: 'a', refreshToken: 'r', expiresAt: 1 }, account: { name: 'X' } } });
    const svc = new IntegrationsService(store, factory, {});
    expect((await svc.update({ zoom: { clientId: 'old' } })).zoom.connected).toBe(true);
    const view = await svc.update({ zoom: { clientId: 'new' } });
    expect(view.zoom.connected).toBe(false);
    expect(store.data.zoom).toEqual({ clientId: 'new', clientSecret: 's' });
    expect((await svc.update({ zoom: { clientId: null, clientSecret: null } })).zoom).toMatchObject({ clientId: undefined, hasClientSecret: false });
  });

  it('validates and normalizes the public Zoom callback URL', async () => {
    expect(normalizeCallbackUrl('https://abc.ngrok-free.app')).toBe('https://abc.ngrok-free.app/api/integrations/zoom/callback');
    expect(normalizeCallbackUrl(' https://abc.ngrok-free.app/api/integrations/zoom/callback/ ')).toBe('https://abc.ngrok-free.app/api/integrations/zoom/callback');
    expect(() => normalizeCallbackUrl('http://abc.ngrok-free.app')).toThrow(/https/);
    expect(() => normalizeCallbackUrl('https://abc.ngrok-free.app/other')).toThrow(/must end with/);
    expect(() => normalizeCallbackUrl('abc')).toThrow(/full https/);

    const svc = new IntegrationsService(new MemoryCredentials(), factory, {});
    expect((await svc.update({ zoom: { callbackUrl: 'https://abc.ngrok-free.app' } })).zoom.callbackUrl).toBe('https://abc.ngrok-free.app/api/integrations/zoom/callback');
    expect((await svc.update({ zoom: { callbackUrl: null } })).zoom.callbackUrl).toBeUndefined();
    await expect(svc.update({ zoom: { callbackUrl: 'http://x' } })).rejects.toThrow(/https/);
  });
});
