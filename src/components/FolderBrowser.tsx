'use client';

import React, { useEffect, useState } from 'react';
import { ArrowUp, ChevronRight, Folder, FolderCheck, Loader2, X } from 'lucide-react';

type Listing = {
  path: string;
  parent: string | null;
  specKit: boolean;
  folders: Array<{ name: string; path: string; specKit: boolean }>;
  places: Array<{ name: string; path: string }>;
};

type Props = {
  startPath?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
};

// "Open Folder" for the project picker: go into folders, then pick one. The
// server lists the folders — a web page can't learn a folder's real path itself.
export const FolderBrowser: React.FC<Props> = ({ startPath, onSelect, onClose }) => {
  const [listing, setListing] = useState<Listing | null>(null);
  const [pathInput, setPathInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async (target?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/workspace/browse${target ? `?path=${encodeURIComponent(target)}` : ''}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `Couldn’t open that folder (${res.status}).`);
        return;
      }
      setListing(data);
      setPathInput(data.path);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { go(startPath); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Breadcrumb: every ancestor of the current folder, root first.
  const crumbs = (() => {
    if (!listing) return [];
    const parts = listing.path.split('/').filter(Boolean);
    return [{ name: '/', path: '/' }, ...parts.map((name, i) => ({ name, path: '/' + parts.slice(0, i + 1).join('/') }))];
  })();

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="folder-browser-title" onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
      <div className="w-full max-w-2xl h-[min(560px,90vh)] flex flex-col rounded-xl bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
          <div>
            <h3 id="folder-browser-title" className="text-sm font-bold text-zinc-900 dark:text-white">Open a project</h3>
            <p className="text-[11px] text-zinc-500">Go into the project’s folder, then click Open this folder.</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-900" aria-label="Close"><X size={15} /></button>
        </div>

        {/* Path bar: Up, clickable breadcrumb, and a typed path for power users */}
        <div className="px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 space-y-1.5">
          <div className="flex items-center gap-1 min-w-0">
            <button
              onClick={() => listing?.parent && go(listing.parent)}
              disabled={!listing?.parent || loading}
              className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-900 disabled:opacity-30 shrink-0"
              aria-label="Up one folder"
              title="Up one folder"
            >
              <ArrowUp size={14} />
            </button>
            <nav aria-label="Folder path" className="flex items-center gap-0.5 min-w-0 overflow-x-auto text-[11px] font-mono whitespace-nowrap">
              {crumbs.map((c, i) => (
                <React.Fragment key={c.path}>
                  {i > 1 && <ChevronRight size={11} className="text-zinc-400 shrink-0" />}
                  <button onClick={() => go(c.path)} className={`px-1 py-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-900 ${i === crumbs.length - 1 ? 'font-semibold text-zinc-900 dark:text-zinc-50' : 'text-zinc-500'}`}>
                    {c.name}
                  </button>
                </React.Fragment>
              ))}
            </nav>
          </div>
          <form onSubmit={e => { e.preventDefault(); go(pathInput); }}>
            <input
              value={pathInput}
              onChange={e => setPathInput(e.target.value)}
              aria-label="Go to folder path"
              placeholder="~/Projects/my-app"
              className="w-full px-2 py-1 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-[11px] font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            />
          </form>
        </div>

        <div className="flex-1 flex min-h-0">
          {/* Shortcuts */}
          <ul className="w-32 shrink-0 border-r border-zinc-200 dark:border-zinc-800 p-2 space-y-0.5 overflow-y-auto hidden sm:block">
            {listing?.places.map(p => (
              <li key={p.path}>
                <button
                  onClick={() => go(p.path)}
                  className={`w-full text-left px-2 py-1 rounded-md text-[11px] truncate ${listing.path === p.path ? 'bg-zinc-100 dark:bg-zinc-900 font-semibold' : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900/60'}`}
                >
                  {p.name}
                </button>
              </li>
            ))}
          </ul>

          {/* Subfolders: click to go in */}
          <div className="flex-1 min-w-0 overflow-y-auto p-2">
            {loading && !listing && <p className="p-3 text-[11px] text-zinc-500 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Loading…</p>}
            {error && <p role="alert" className="m-1 p-2 rounded-md bg-red-500/10 text-[11px] text-red-700 dark:text-red-300">{error}</p>}
            {listing && listing.folders.length === 0 && !error && <p className="p-3 text-[11px] text-zinc-500 italic">No folders here.</p>}
            <ul role="listbox" aria-label="Folders" className="space-y-0.5">
              {listing?.folders.map(f => (
                <li key={f.path} className="group/row flex items-center gap-1">
                  <button
                    role="option"
                    aria-selected={false}
                    onClick={() => go(f.path)}
                    className="flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5 rounded-md text-left hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
                    title={`Go into ${f.name}`}
                  >
                    {f.specKit ? <FolderCheck size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0" /> : <Folder size={14} className="text-zinc-400 shrink-0" />}
                    <span className="text-xs truncate">{f.name}</span>
                    {f.specKit && <span className="text-[9px] font-semibold text-emerald-700 dark:text-emerald-400 shrink-0">Spec Kit</span>}
                  </button>
                  <button
                    onClick={() => onSelect(f.path)}
                    className="px-2 py-1 rounded-md text-[10px] font-semibold border border-zinc-200 dark:border-zinc-800 opacity-0 group-hover/row:opacity-100 focus:opacity-100 hover:bg-zinc-100 dark:hover:bg-zinc-900 shrink-0"
                    aria-label={`Open ${f.name} as the project`}
                  >
                    Open
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-zinc-200 dark:border-zinc-800">
          <p className="text-[11px] min-w-0">
            <span className="block font-mono text-zinc-700 dark:text-zinc-300 truncate">{listing?.path ?? ''}</span>
            {listing && (listing.specKit
              ? <span className="text-emerald-700 dark:text-emerald-400">Spec Kit project</span>
              : <span className="text-zinc-500">No Spec Kit yet. You can set it up after opening.</span>)}
          </p>
          <div className="flex gap-2 shrink-0">
            <button onClick={onClose} className="px-3 py-2 rounded-lg text-xs font-semibold border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900">Cancel</button>
            <button
              onClick={() => listing && onSelect(listing.path)}
              disabled={!listing || loading}
              className="px-3 py-2 rounded-lg text-xs font-semibold bg-black dark:bg-white text-white dark:text-black hover:opacity-90 disabled:opacity-40"
            >
              Open this folder
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FolderBrowser;
