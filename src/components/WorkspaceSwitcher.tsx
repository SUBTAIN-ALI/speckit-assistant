'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, FolderOpen, Loader2, X } from 'lucide-react';

type WorkspaceInfo = { path: string; name: string; exists: boolean; specKit: boolean };

type Props = {
  // An agent run streams into this page; switching would cut the page off from it.
  busy: boolean;
};

// Header dropdown for the project (workspace) the app works on: meetings,
// specs, the board and the code the agents change all belong to it.
export const WorkspaceSwitcher: React.FC<Props> = ({ busy }) => {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<WorkspaceInfo | null>(null);
  const [recent, setRecent] = useState<WorkspaceInfo[]>([]);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const load = async () => {
    try {
      const res = await fetch('/api/workspace');
      const data = await res.json();
      if (res.ok) {
        setCurrent(data.current);
        setRecent(data.recent);
      }
    } catch {
      // the header keeps its last value
    }
  };

  useEffect(() => { load(); }, []);

  // Close on a click outside or Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const switchTo = async (target: string) => {
    setError(null);
    setSwitching(target);
    try {
      const res = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: target }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Couldn’t open that folder (${res.status}).`);
        setSwitching(null);
        return;
      }
      // Every view (board, requirements, agents, live file watcher) belongs to
      // the project, so start the page fresh on the new one.
      window.location.reload();
    } catch (err: any) {
      setError(err.message);
      setSwitching(null);
    }
  };

  const forget = async (target: string) => {
    await fetch('/api/workspace', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: target }),
    }).catch(() => undefined);
    load();
  };

  const badge = (w: WorkspaceInfo) =>
    !w.exists ? <span className="text-[9px] font-semibold text-red-600 dark:text-red-400">missing</span>
      : !w.specKit ? <span className="text-[9px] font-semibold text-amber-600 dark:text-amber-400">no Spec Kit</span>
        : null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => { setOpen(o => !o); setError(null); }}
        className="flex items-center gap-1.5 text-left group"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={current?.path}
      >
        <FolderOpen size={11} className="text-zinc-400" />
        <span className="text-[10px] font-mono text-zinc-500 group-hover:text-zinc-900 dark:group-hover:text-zinc-100 max-w-[220px] truncate">
          {current ? current.name : 'Loading project…'}
        </span>
        <ChevronDown size={11} className="text-zinc-400" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-2 w-[380px] max-w-[calc(100vw-32px)] rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-xl z-50 p-2">
          <p className="px-2 pt-1 pb-2 text-[10px] text-zinc-500">
            Meetings, specs, the board and the code changes all belong to the open project.
          </p>
          {busy && (
            <p className="mx-2 mb-2 text-[10px] text-amber-700 dark:text-amber-400 bg-amber-500/10 rounded-md p-2">
              An agent is running. Stop it or let it finish before switching projects.
            </p>
          )}

          <ul role="listbox" className="space-y-0.5">
            {[...(current ? [current] : []), ...recent].map(w => {
              const isCurrent = w.path === current?.path;
              return (
                <li key={w.path} className="group/item flex items-center gap-1">
                  <button
                    role="option"
                    aria-selected={isCurrent}
                    disabled={isCurrent || busy || !w.exists || switching !== null}
                    onClick={() => switchTo(w.path)}
                    className={`flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition ${isCurrent ? 'bg-zinc-100 dark:bg-zinc-900' : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/60 disabled:opacity-50 disabled:hover:bg-transparent'}`}
                  >
                    <span className="w-3 shrink-0">
                      {switching === w.path ? <Loader2 size={12} className="animate-spin" /> : isCurrent ? <Check size={12} /> : null}
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold truncate">{w.name}</span>
                        {badge(w)}
                      </span>
                      <span className="block text-[10px] font-mono text-zinc-400 truncate">{w.path}</span>
                    </span>
                  </button>
                  {!isCurrent && (
                    <button
                      onClick={() => forget(w.path)}
                      className="p-1 rounded opacity-0 group-hover/item:opacity-100 focus:opacity-100 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
                      aria-label={`Remove ${w.name} from the list`}
                      title="Remove from the list (the folder isn’t touched)"
                    >
                      <X size={12} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          <form
            className="mt-2 pt-2 border-t border-zinc-200 dark:border-zinc-800 flex gap-1.5"
            onSubmit={e => { e.preventDefault(); if (input.trim()) switchTo(input); }}
          >
            <input
              value={input}
              onChange={e => { setInput(e.target.value); setError(null); }}
              placeholder="Open a folder: ~/Projects/my-app"
              aria-label="Project folder path"
              className="flex-1 min-w-0 px-2 py-1.5 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-[11px] font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            />
            <button
              type="submit"
              disabled={!input.trim() || busy || switching !== null}
              className="px-2.5 py-1.5 rounded-md text-[11px] font-semibold bg-black dark:bg-white text-white dark:text-black disabled:opacity-40"
            >
              Open
            </button>
          </form>
          {error && <p role="alert" className="px-1 pt-1.5 text-[10px] text-red-600 dark:text-red-400">{error}</p>}
        </div>
      )}
    </div>
  );
};

export default WorkspaceSwitcher;
