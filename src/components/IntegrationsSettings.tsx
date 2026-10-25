'use client';

import React, { useEffect, useState } from 'react';
import { KeyRound, Video, Check, Copy, Loader2, Unplug, Plug, RefreshCw, ExternalLink, AlertTriangle } from 'lucide-react';
import { zoomRedirectUriFor } from '../lib/zoomRedirect';
import {
  IntegrationsView,
  LLM_PROVIDERS,
  LLM_PROVIDER_LABELS,
  LlmProvider,
} from '../domain/models/credentials';

type Props = {
  view: IntegrationsView | null;
  onChange: (view: IntegrationsView) => void;
};

const ZOOM_SCOPES = [
  'meeting:read:search',
  'meeting:read:assets',
  'cloud_recording:read:list_user_recordings',
  'cloud_recording:read:content',
];

const KEY_PLACEHOLDER: Record<LlmProvider, string> = {
  openai: 'sk-…',
  anthropic: 'sk-ant-…',
  google: 'AIza…',
};

const inputCls = 'w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40';
const labelCls = 'block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 mb-1';
const btnCls = 'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition disabled:opacity-50';
const primaryBtn = `${btnCls} bg-black dark:bg-white text-white dark:text-black hover:opacity-90`;
const secondaryBtn = `${btnCls} border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900`;

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}

export const IntegrationsSettings: React.FC<Props> = ({ view, onChange }) => {
  // --- AI provider ---
  const [provider, setProvider] = useState<LlmProvider>('openai');
  const [keyDraft, setKeyDraft] = useState<Partial<Record<LlmProvider, string>>>({});
  const [modelDraft, setModelDraft] = useState<Partial<Record<LlmProvider, string>>>({});
  const [models, setModels] = useState<Partial<Record<LlmProvider, string[]>>>({});
  const [llmBusy, setLlmBusy] = useState<'save' | 'models' | null>(null);
  const [llmMsg, setLlmMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // --- Zoom ---
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [callbackUrl, setCallbackUrl] = useState('');
  const [zoomBusy, setZoomBusy] = useState<'save' | 'connect' | 'disconnect' | 'test' | null>(null);
  const [zoomMsg, setZoomMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [tools, setTools] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState('');

  useEffect(() => {
    if (!view) return;
    setProvider(view.llm.provider);
    setModelDraft(view.llm.models);
    setClientId(view.zoom.clientId ?? '');
    setCallbackUrl(view.zoom.callbackUrl ?? '');
  }, [view]);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  if (!view) {
    return <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 size={14} className="animate-spin" /> Loading settings…</div>;
  }

  // What Zoom will be sent: the saved public callback URL, else the local default.
  const redirectUri = view.zoom.callbackUrl ?? (origin ? zoomRedirectUriFor(origin) : '');
  const localPort = origin ? new URL(origin).port || '80' : '3000';
  const configured = view.llm.configured[provider];

  const saveLlm = async () => {
    setLlmBusy('save');
    setLlmMsg(null);
    try {
      const keys: Partial<Record<LlmProvider, string>> = {};
      for (const p of LLM_PROVIDERS) if (keyDraft[p]?.trim()) keys[p] = keyDraft[p]!.trim();
      const next = await call<IntegrationsView>('/api/settings/integrations', {
        method: 'PUT',
        body: JSON.stringify({ llm: { provider, keys, models: modelDraft } }),
      });
      onChange(next);
      setKeyDraft({});
      setLlmMsg({ ok: true, text: `Saved. Requirements will be extracted with ${LLM_PROVIDER_LABELS[provider]} · ${next.llm.models[provider]}.` });
    } catch (err: any) {
      setLlmMsg({ ok: false, text: err.message });
    } finally {
      setLlmBusy(null);
    }
  };

  const removeKey = async (p: LlmProvider) => {
    try {
      onChange(await call<IntegrationsView>('/api/settings/integrations', {
        method: 'PUT',
        body: JSON.stringify({ llm: { keys: { [p]: null } } }),
      }));
      setLlmMsg({ ok: true, text: `${LLM_PROVIDER_LABELS[p]} key removed.` });
    } catch (err: any) {
      setLlmMsg({ ok: false, text: err.message });
    }
  };

  const loadModels = async () => {
    setLlmBusy('models');
    setLlmMsg(null);
    try {
      const { models: list } = await call<{ models: string[] }>('/api/llm/models', {
        method: 'POST',
        body: JSON.stringify({ provider, apiKey: keyDraft[provider] || undefined }),
      });
      setModels(m => ({ ...m, [provider]: list }));
      setLlmMsg({ ok: true, text: `Key works — ${list.length} models available.` });
    } catch (err: any) {
      setLlmMsg({ ok: false, text: err.message });
    } finally {
      setLlmBusy(null);
    }
  };

  const saveZoom = async () => {
    setZoomBusy('save');
    setZoomMsg(null);
    try {
      const next = await call<IntegrationsView>('/api/settings/integrations', {
        method: 'PUT',
        body: JSON.stringify({ zoom: { clientId, callbackUrl: callbackUrl.trim() || null, ...(clientSecret.trim() ? { clientSecret } : {}) } }),
      });
      onChange(next);
      setClientSecret('');
      setZoomMsg({ ok: true, text: 'Zoom app saved. Now click “Connect Zoom”.' });
    } catch (err: any) {
      setZoomMsg({ ok: false, text: err.message });
    } finally {
      setZoomBusy(null);
    }
  };

  const connect = async () => {
    setZoomBusy('connect');
    setZoomMsg(null);
    try {
      const { url } = await call<{ url: string }>('/api/integrations/zoom/connect', { method: 'POST' });
      window.location.href = url;
    } catch (err: any) {
      setZoomMsg({ ok: false, text: err.message });
      setZoomBusy(null);
    }
  };

  const disconnect = async () => {
    setZoomBusy('disconnect');
    try {
      onChange(await call<IntegrationsView>('/api/integrations/zoom/disconnect', { method: 'POST' }));
      setTools(null);
      setZoomMsg({ ok: true, text: 'Disconnected from Zoom.' });
    } catch (err: any) {
      setZoomMsg({ ok: false, text: err.message });
    } finally {
      setZoomBusy(null);
    }
  };

  const testZoom = async () => {
    setZoomBusy('test');
    setZoomMsg(null);
    try {
      const { tools: list } = await call<{ tools: { name: string }[] }>('/api/integrations/zoom/tools');
      setTools(list.map(t => t.name));
      setZoomMsg({ ok: true, text: `Connected to Zoom’s MCP server — ${list.length} tools available.` });
    } catch (err: any) {
      setZoomMsg({ ok: false, text: err.message });
    } finally {
      setZoomBusy(null);
    }
  };

  const copyRedirect = async () => {
    try {
      await navigator.clipboard.writeText(redirectUri);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked; the URL is selectable
    }
  };

  const Msg = ({ m }: { m: { ok: boolean; text: string } | null }) =>
    m ? (
      <p role="status" className={`mt-3 text-[11px] flex items-start gap-1.5 ${m.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
        {m.ok ? <Check size={12} className="mt-0.5 shrink-0" /> : <AlertTriangle size={12} className="mt-0.5 shrink-0" />}
        <span>{m.text}</span>
      </p>
    ) : null;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 max-w-6xl">
      {/* AI provider */}
      <section className="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
        <h3 className="text-sm font-bold text-zinc-900 dark:text-white flex items-center gap-2"><KeyRound size={15} /> AI provider</h3>
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">
          Your own API key turns meeting transcripts into requirements. Keys are stored only on this computer
          (<code className="font-mono">~/.speckit-assistant/credentials.json</code>) and never sent anywhere except the provider.
        </p>

        <div className="mt-4 flex flex-wrap gap-2" role="radiogroup" aria-label="AI provider">
          {LLM_PROVIDERS.map(p => (
            <button
              key={p}
              role="radio"
              aria-checked={provider === p}
              onClick={() => { setProvider(p); setLlmMsg(null); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition flex items-center gap-1.5 ${provider === p
                ? 'border-blue-500 bg-blue-500/10 text-blue-700 dark:text-blue-300'
                : 'border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900'}`}
            >
              {LLM_PROVIDER_LABELS[p]}
              {view.llm.configured[p] && <Check size={12} className="text-emerald-500" aria-label="key saved" />}
            </button>
          ))}
        </div>

        <div className="mt-4 space-y-3">
          <div>
            <label className={labelCls} htmlFor="llm-key">{LLM_PROVIDER_LABELS[provider]} API key</label>
            <div className="flex gap-2">
              <input
                id="llm-key"
                type="password"
                autoComplete="off"
                className={inputCls}
                placeholder={view.llm.keyHints[provider] ? `Saved (${view.llm.keyHints[provider]}) — paste a new key to replace` : view.llm.envKey[provider] ? 'Using the key from your environment' : KEY_PLACEHOLDER[provider]}
                value={keyDraft[provider] ?? ''}
                onChange={e => setKeyDraft(d => ({ ...d, [provider]: e.target.value }))}
              />
              {view.llm.keyHints[provider] && (
                <button onClick={() => removeKey(provider)} className={secondaryBtn} title="Remove saved key">Remove</button>
              )}
            </div>
          </div>
          <div>
            <label className={labelCls} htmlFor="llm-model">Model</label>
            <div className="flex gap-2">
              <input
                id="llm-model"
                list="llm-models"
                className={`${inputCls} font-mono`}
                value={modelDraft[provider] ?? ''}
                onChange={e => setModelDraft(d => ({ ...d, [provider]: e.target.value }))}
              />
              <datalist id="llm-models">
                {(models[provider] ?? []).map(m => <option key={m} value={m} />)}
              </datalist>
              <button onClick={loadModels} disabled={llmBusy !== null || (!configured && !keyDraft[provider])} className={secondaryBtn} title="Check the key and list available models">
                {llmBusy === 'models' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Test key
              </button>
            </div>
            <p className="text-[10px] text-zinc-500 mt-1">“Test key” checks the key and fills this list with the models your account can use.</p>
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <button onClick={saveLlm} disabled={llmBusy !== null} className={primaryBtn}>
            {llmBusy === 'save' && <Loader2 size={13} className="animate-spin" />} Save AI settings
          </button>
        </div>
        <Msg m={llmMsg} />
      </section>

      {/* Zoom */}
      <section className="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-zinc-900 dark:text-white flex items-center gap-2"><Video size={15} /> Zoom</h3>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${view.zoom.connected ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-zinc-100 dark:bg-zinc-900 text-zinc-500'}`}>
            {view.zoom.connected ? `Connected${view.zoom.account?.name || view.zoom.account?.email ? ` as ${view.zoom.account?.name || view.zoom.account?.email}` : ''}` : 'Not connected'}
          </span>
        </div>
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">
          Uses your own Zoom app to read transcripts and AI summaries of meetings in your account through Zoom’s MCP server. Read-only.
        </p>

        <details className="mt-3 text-[11px] text-zinc-600 dark:text-zinc-400 rounded-lg bg-zinc-50 dark:bg-zinc-900/60 p-3" open={!view.zoom.clientId}>
          <summary className="cursor-pointer font-semibold text-zinc-700 dark:text-zinc-300">How to create your Zoom app (one time, ~5 minutes)</summary>
          <ol className="list-decimal ml-4 mt-2 space-y-1.5">
            <li>Open the <a className="text-blue-600 dark:text-blue-400 underline inline-flex items-center gap-0.5" href="https://marketplace.zoom.us/develop/create" target="_blank" rel="noreferrer">Zoom App Marketplace <ExternalLink size={10} /></a> and create a <b>General App</b> with <b>user-managed</b> OAuth.</li>
            <li>Zoom only accepts public <b>https</b> redirect URLs, so forward one to this app with a tunnel, e.g.{' '}
              <code className="font-mono text-[10px]">ngrok http {localPort}</code> (a free static ngrok domain keeps the URL stable) or{' '}
              <code className="font-mono text-[10px]">cloudflared tunnel --url http://127.0.0.1:{localPort}</code>.
              Paste the tunnel’s https address into <b>Public callback URL</b> below and save. Only the Zoom callback is reachable through the tunnel — the rest of the app stays local.</li>
            <li>Paste this exactly into both <b>OAuth Redirect URL</b> and <b>OAuth Allow List</b>:
              <div className="mt-1 flex items-center gap-1.5">
                <code className="font-mono text-[10px] px-2 py-1 rounded bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 select-all break-all">{redirectUri}</code>
                <button onClick={copyRedirect} className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800" title="Copy" aria-label="Copy redirect URL">
                  {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                </button>
              </div>
            </li>
            <li>Under <b>Scopes</b>, add: {ZOOM_SCOPES.map((s, i) => <span key={s}><code className="font-mono text-[10px]">{s}</code>{i < ZOOM_SCOPES.length - 1 ? ', ' : ''}</span>)}.</li>
            <li>Copy the app’s <b>Client ID</b> and <b>Client Secret</b> below, save, then click <b>Connect Zoom</b>.</li>
          </ol>
          <p className="mt-2">Transcripts exist only for meetings recorded to the cloud with audio transcript on, or with AI Companion summaries enabled.</p>
        </details>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className={labelCls} htmlFor="zoom-callback-url">Public callback URL (https tunnel)</label>
            <input id="zoom-callback-url" className={`${inputCls} font-mono`} value={callbackUrl} onChange={e => setCallbackUrl(e.target.value)}
              placeholder="https://your-name.ngrok-free.app" autoComplete="off" />
            {!view.zoom.callbackUrl && <p className="text-[10px] text-zinc-500 mt-1">Required: Zoom rejects local addresses like localhost and 127.0.0.1.</p>}
          </div>
          <div>
            <label className={labelCls} htmlFor="zoom-client-id">Client ID</label>
            <input id="zoom-client-id" className={`${inputCls} font-mono`} value={clientId} onChange={e => setClientId(e.target.value)} autoComplete="off" />
          </div>
          <div>
            <label className={labelCls} htmlFor="zoom-client-secret">Client secret</label>
            <input
              id="zoom-client-secret"
              type="password"
              className={`${inputCls} font-mono`}
              placeholder={view.zoom.hasClientSecret ? 'Saved — paste to replace' : ''}
              value={clientSecret}
              onChange={e => setClientSecret(e.target.value)}
              autoComplete="off"
            />
          </div>
        </div>
        {view.zoom.connected && clientId.trim() !== (view.zoom.clientId ?? '') && (
          <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">Saving a different Client ID disconnects Zoom; you’ll need to connect again.</p>
        )}

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button onClick={saveZoom} disabled={zoomBusy !== null || !clientId.trim()} className={secondaryBtn}>
            {zoomBusy === 'save' && <Loader2 size={13} className="animate-spin" />} Save Zoom app
          </button>
          {view.zoom.connected ? (
            <>
              <button onClick={testZoom} disabled={zoomBusy !== null} className={secondaryBtn}>
                {zoomBusy === 'test' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Test connection
              </button>
              <button onClick={disconnect} disabled={zoomBusy !== null} className={secondaryBtn}>
                {zoomBusy === 'disconnect' ? <Loader2 size={13} className="animate-spin" /> : <Unplug size={13} />} Disconnect
              </button>
            </>
          ) : (
            <button onClick={connect} disabled={zoomBusy !== null || !view.zoom.clientId || !view.zoom.hasClientSecret} className={primaryBtn}>
              {zoomBusy === 'connect' ? <Loader2 size={13} className="animate-spin" /> : <Plug size={13} />} Connect Zoom
            </button>
          )}
        </div>
        <Msg m={zoomMsg} />
        {tools && tools.length > 0 && (
          <p className="mt-2 text-[10px] text-zinc-500 font-mono break-words">Tools: {tools.join(', ')}</p>
        )}
      </section>
    </div>
  );
};

export default IntegrationsSettings;
