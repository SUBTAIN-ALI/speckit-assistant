'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, Loader2, Monitor, Play, RotateCw, Square, Wand2, Wrench } from 'lucide-react';
import { PreviewConfig, PreviewStatus, normalizePath, stripAnsi } from '../domain/models/preview';
import { readSse } from '../lib/sse';

type View = { config: PreviewConfig | null; configError?: string; status: PreviewStatus };

type Props = {
  active: boolean; // the tab is visible (poll only then)
  featureName: string | null; // the feature to show, for the agent's "path" hint
};

// The open project, running locally, next to the board. The agent works out how
// to run it (once); this app runs it and shows the page.
export const PreviewPanel: React.FC<Props> = ({ active, featureName }) => {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'start' | 'stop' | 'save'>(null);
  const [agentRun, setAgentRun] = useState<null | { mode: 'prepare' | 'fix'; log: string }>(null);
  const [agentResult, setAgentResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ command: '', cwd: '', path: '' });
  const [showLogs, setShowLogs] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/preview');
      const data = await res.json();
      if (res.ok) setView(data);
    } catch {
      // keep the last view
    }
  }, []);

  // Follow the server while the tab is visible: fast while starting, slow otherwise.
  const state = view?.status.state;
  useEffect(() => {
    if (!active) return;
    load();
    const t = setInterval(load, state === 'starting' ? 1000 : 4000);
    return () => clearInterval(t);
  }, [active, state, load]);

  useEffect(() => {
    if (state === 'failed') setShowLogs(true);
  }, [state]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [agentRun?.log, view?.status.logs, showLogs]);

  const call = async (action: 'start' | 'stop') => {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch('/api/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
      const data = await res.json();
      if (!res.ok) setError(data.error);
      else setView(data);
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy('save');
    setError(null);
    try {
      const res = await fetch('/api/preview', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...view?.config, command: form.command, cwd: form.cwd, path: form.path || undefined }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error);
      else { setView(data); setEditing(false); }
    } finally {
      setBusy(null);
    }
  };

  const runAgent = async (mode: 'prepare' | 'fix') => {
    setAgentRun({ mode, log: '' });
    setAgentResult(null);
    setError(null);
    try {
      const res = await fetch('/api/preview/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, feature: featureName }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        setAgentResult({ ok: false, message: data.error || `Request failed (${res.status})` });
        return;
      }
      await readSse(res, (event, data: any) => {
        if (event === 'log') setAgentRun(r => (r ? { ...r, log: (r.log + stripAnsi(data.text)).slice(-40_000) } : r));
        else if (event === 'done') setAgentResult({ ok: data.ok, message: data.message });
        else if (event === 'error') setAgentResult({ ok: false, message: data.message });
      });
    } catch (err: any) {
      setAgentResult({ ok: false, message: err.message });
    } finally {
      setAgentRun(null);
      await load();
    }
  };

  // After a successful prepare/fix, start the server straight away.
  useEffect(() => {
    if (agentResult?.ok && view?.config && view.status.state !== 'running' && view.status.state !== 'starting') call('start');
  }, [agentResult]); // eslint-disable-line react-hooks/exhaustive-deps

  const config = view?.config ?? null;
  const status = view?.status;
  const pageUrl = status?.url ? `${status.url}${config?.path ?? ''}` : null;

  // Auto-open in a new browser tab once the server is ready.
  const prevStateRef = useRef(state);
  useEffect(() => {
    if (prevStateRef.current !== 'running' && state === 'running' && pageUrl) {
      window.open(pageUrl, '_blank', 'noopener');
    }
    prevStateRef.current = state;
  }, [state, pageUrl]);
  const agentBusy = agentRun !== null;
  const btn = 'flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900 disabled:opacity-40';
  const primary = 'flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-black dark:bg-white text-white dark:text-black hover:opacity-90 disabled:opacity-40';

  if (!view) {
    return <div className="h-full flex items-center justify-center text-xs text-zinc-500"><Loader2 size={14} className="animate-spin mr-1.5" /> Loading preview…</div>;
  }

  return (
    <div className="h-full flex flex-col bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 border-b border-zinc-200 dark:border-zinc-800">
        {config && !editing ? (
          <>
            {status?.state === 'running' || status?.state === 'starting' ? (
              <>
                <button className={btn} onClick={() => call('stop')} disabled={busy !== null || agentBusy}><Square size={11} /> Stop</button>
                <button className={btn} onClick={() => call('start')} disabled={busy !== null || agentBusy} title="Restart the server"><RotateCw size={11} /> Restart</button>
              </>
            ) : (
              <button className={primary} onClick={() => call('start')} disabled={busy !== null || agentBusy}>
                {busy === 'start' ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} fill="currentColor" />} Start preview
              </button>
            )}
            <code className="text-[10px] font-mono text-zinc-500 truncate max-w-[260px]" title={`${config.cwd ? `${config.cwd}: ` : ''}${config.command}`}>
              {config.cwd ? `${config.cwd}$ ` : '$ '}{config.command}
            </code>
            <button className="text-[10px] underline text-zinc-500" onClick={() => { setForm({ command: config.command, cwd: config.cwd ?? '', path: config.path ?? '' }); setEditing(true); }} disabled={agentBusy}>Edit</button>
            <button className="text-[10px] underline text-zinc-500" onClick={() => runAgent('prepare')} disabled={agentBusy || busy !== null}>Ask agent again</button>

            {pageUrl && (
              <div className="ml-auto flex items-center gap-1">
                <span className="text-[10px] font-mono text-zinc-500 truncate max-w-[220px]">{pageUrl}</span>
                <a className={btn} href={pageUrl} target="_blank" rel="noreferrer" title="Open in browser"><ExternalLink size={11} /> Open</a>
              </div>
            )}
          </>
        ) : null}
      </div>

      {error && <p role="alert" className="mx-3 mt-2 p-2 rounded-md bg-red-500/10 text-[11px] text-red-700 dark:text-red-300">{error}</p>}
      {view.configError && <p role="alert" className="mx-3 mt-2 p-2 rounded-md bg-amber-500/10 text-[11px] text-amber-700 dark:text-amber-400">{view.configError}</p>}
      {agentResult && (
        <p role={agentResult.ok ? 'status' : 'alert'} className={`mx-3 mt-2 p-2 rounded-md text-[11px] ${agentResult.ok ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300' : 'bg-red-500/10 text-red-700 dark:text-red-300'}`}>
          {agentResult.message}
        </p>
      )}

      {/* Body */}
      <div className="flex-1 min-h-0 flex flex-col">
        {agentBusy ? (
          <div className="flex-1 min-h-0 flex flex-col p-3 gap-2">
            <p className="text-[11px] text-zinc-600 dark:text-zinc-400 flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin" />
              {agentRun!.mode === 'fix' ? 'Your agent is fixing the preview…' : 'Your agent is working out how to run this project…'}
            </p>
            <pre ref={logRef} className="flex-1 min-h-0 overflow-auto rounded-md bg-zinc-950 text-zinc-300 text-[10px] font-mono p-2 whitespace-pre-wrap">{agentRun!.log || 'Starting the agent…'}</pre>
          </div>
        ) : editing || !config ? (
          <div className="p-4 max-w-xl space-y-3">
            {!config && !editing && (
              <>
                <p className="text-xs font-semibold">Preview this project while you work</p>
                <p className="text-[11px] text-zinc-500">
                  Your agent works out how to run it (installs dependencies if needed) and saves the command in <code>.specify/preview.json</code>.
                  This app then runs it on your computer and shows the page here.
                </p>
                <button className={primary} onClick={() => runAgent('prepare')} disabled={agentBusy}><Wand2 size={11} /> Prepare preview with your agent</button>
                <p className="text-[11px] text-zinc-500">
                  Or <button className="underline font-semibold" onClick={() => { setForm({ command: '', cwd: '', path: '' }); setEditing(true); }}>enter the command yourself</button>.
                </p>
              </>
            )}
            {editing && (
              <form className="space-y-2" onSubmit={e => { e.preventDefault(); save(); }}>
                <label className="block text-[11px] font-semibold">Start command
                  <input autoFocus value={form.command} onChange={e => setForm(f => ({ ...f, command: e.target.value }))} placeholder="pnpm dev"
                    className="mt-1 w-full px-2 py-1.5 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-[11px] font-mono" />
                </label>
                <p className="text-[10px] text-zinc-500">Runs in the foreground; the app sets <code>PORT</code> and replaces <code>{'{port}'}</code> with a free port.</p>
                <div className="flex gap-2">
                  <label className="flex-1 block text-[11px] font-semibold">Folder <span className="font-normal text-zinc-400">(optional)</span>
                    <input value={form.cwd} onChange={e => setForm(f => ({ ...f, cwd: e.target.value }))} placeholder="apps/web"
                      className="mt-1 w-full px-2 py-1.5 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-[11px] font-mono" />
                  </label>
                  <label className="flex-1 block text-[11px] font-semibold">Page <span className="font-normal text-zinc-400">(optional)</span>
                    <input value={form.path} onChange={e => setForm(f => ({ ...f, path: e.target.value ? normalizePath(e.target.value) : '' }))} placeholder="/"
                      className="mt-1 w-full px-2 py-1.5 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-[11px] font-mono" />
                  </label>
                </div>
                <div className="flex gap-2">
                  <button type="submit" className={primary} disabled={!form.command.trim() || busy !== null}>Save</button>
                  <button type="button" className={btn} onClick={() => setEditing(false)}>Cancel</button>
                </div>
              </form>
            )}
          </div>
        ) : status?.state === 'running' && pageUrl ? (
          <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-4 bg-zinc-50 dark:bg-zinc-900/50">
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
              <Monitor size={20} />
              <span className="text-sm font-semibold">Preview is running</span>
            </div>
            <a href={pageUrl} target="_blank" rel="noreferrer"
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-black dark:bg-white text-white dark:text-black text-sm font-semibold hover:opacity-90">
              <ExternalLink size={14} /> Open in Browser
            </a>
            <code className="text-[11px] font-mono text-zinc-500">{pageUrl}</code>
            <p className="text-[10px] text-zinc-400 max-w-xs text-center">
              Your project opens in a new browser tab automatically when the server starts.
              Click the button above to reopen it.
            </p>
          </div>
        ) : (
          <div className="p-4 space-y-2">
            {status?.state === 'starting' && <p className="text-[11px] text-zinc-600 dark:text-zinc-400 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Starting the server…</p>}
            {status?.state === 'failed' && (
              <div className="space-y-2">
                <p className="text-[11px] text-red-700 dark:text-red-300">{status.error ?? 'The preview failed.'}</p>
                <button className={primary} onClick={() => runAgent('fix')}><Wrench size={11} /> Fix with your agent</button>
              </div>
            )}
            {status?.state === 'stopped' && (
              <p className="text-[11px] text-zinc-500">
                The preview isn’t running. Click <strong>Start preview</strong>.{config.notes ? ` Note from your agent: ${config.notes}` : ''}
              </p>
            )}
          </div>
        )}

        {/* Server output */}
        {!agentBusy && status && status.logs && (
          <div className="border-t border-zinc-200 dark:border-zinc-800">
            <button onClick={() => setShowLogs(s => !s)} className="w-full text-left px-3 py-1 text-[10px] font-semibold text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
              {showLogs ? '▾' : '▸'} Server output
            </button>
            {showLogs && <pre ref={logRef} className="max-h-48 overflow-auto bg-zinc-950 text-zinc-300 text-[10px] font-mono p-2 whitespace-pre-wrap">{status.logs}</pre>}
          </div>
        )}
      </div>
    </div>
  );
};

export default PreviewPanel;
