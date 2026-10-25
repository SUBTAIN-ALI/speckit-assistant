'use client';

import React, { useMemo, useState } from 'react';
import {
  Plus, Pencil, Trash2, Check, X, RotateCcw, ArrowUp, ArrowDown, Quote, Search, FileText, Video, Loader2, GitBranch,
} from 'lucide-react';
import {
  Requirement,
  RequirementInput,
  RequirementsDoc,
  RequirementStatus,
  REQUIREMENT_TYPES,
  REQUIREMENT_STATUSES,
  REQUIREMENT_PRIORITIES,
  RequirementPriority,
  requirementsPath,
} from '../domain/models/requirements';
import { RequirementEditor } from './RequirementEditor';
import { PRIORITY_CLS, PRIORITY_LABELS, STATUS_CLS, STATUS_LABELS, TYPE_LABELS } from './requirementLabels';

type Props = {
  setId: string;
  doc: RequirementsDoc | null;
  onDocChange: (doc: RequirementsDoc | null) => void;
  onImport: () => void;
  onOpenFeature?: (feature: string) => void;
};

async function call<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}

type Undo = { requirement: Requirement; index: number; timer: ReturnType<typeof setTimeout> };

export const RequirementsPanel: React.FC<Props> = ({ setId, doc, onDocChange, onImport, onOpenFeature }) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<RequirementStatus | 'all'>('all');
  const [priorityFilter, setPriorityFilter] = useState<RequirementPriority | 'all'>('all');
  const [undo, setUndo] = useState<Undo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [raw, setRaw] = useState<{ content: string; saving: boolean } | null>(null);

  const requirements = doc?.requirements ?? [];

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return requirements.filter(r =>
      (statusFilter === 'all' || r.status === statusFilter) &&
      (priorityFilter === 'all' || r.priority === priorityFilter) &&
      (!q || [r.id, r.title, r.description, ...r.acceptanceCriteria, r.source?.quote ?? ''].some(s => s.toLowerCase().includes(q)))
    );
  }, [requirements, query, statusFilter, priorityFilter]);

  const counts = useMemo(() => {
    const c = { draft: 0, accepted: 0, rejected: 0 } as Record<RequirementStatus, number>;
    for (const r of requirements) c[r.status]++;
    return c;
  }, [requirements]);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const add = (input: RequirementInput) => run(async () => {
    const { doc: next } = await call<{ doc: RequirementsDoc }>('/api/requirements', { method: 'POST', body: JSON.stringify({ set: setId, requirement: input }) });
    onDocChange(next);
    setAdding(false);
  });

  const update = (id: string, patch: RequirementInput) => run(async () => {
    const { doc: next } = await call<{ doc: RequirementsDoc }>('/api/requirements', { method: 'PATCH', body: JSON.stringify({ set: setId, id, patch }) });
    onDocChange(next);
    setEditingId(null);
  });

  const remove = (id: string) => run(async () => {
    const res = await call<{ doc: RequirementsDoc; removed: Requirement; index: number }>(
      `/api/requirements?${new URLSearchParams({ set: setId, id })}`, { method: 'DELETE' });
    onDocChange(res.doc);
    if (undo) clearTimeout(undo.timer);
    const timer = setTimeout(() => setUndo(null), 8000);
    setUndo({ requirement: res.removed, index: res.index, timer });
  });

  const restore = () => run(async () => {
    if (!undo) return;
    clearTimeout(undo.timer);
    const { doc: next } = await call<{ doc: RequirementsDoc }>('/api/requirements', {
      method: 'POST', body: JSON.stringify({ set: setId, restore: { requirement: undo.requirement, index: undo.index } }),
    });
    onDocChange(next);
    setUndo(null);
  });

  const move = (id: string, delta: number) => run(async () => {
    const ids = requirements.map(r => r.id);
    const i = ids.indexOf(id);
    const j = i + delta;
    if (i === -1 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    const { doc: next } = await call<{ doc: RequirementsDoc }>('/api/requirements', { method: 'PATCH', body: JSON.stringify({ set: setId, order: ids }) });
    onDocChange(next);
  });

  const acceptAllDrafts = () => run(async () => {
    let next = doc;
    for (const r of requirements.filter(x => x.status === 'draft')) {
      next = (await call<{ doc: RequirementsDoc }>('/api/requirements', { method: 'PATCH', body: JSON.stringify({ set: setId, id: r.id, patch: { status: 'accepted' } }) })).doc;
    }
    onDocChange(next);
  });

  const openRaw = () => run(async () => {
    const res = await fetch(`/api/file?${new URLSearchParams({ path: requirementsPath(setId) })}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    setRaw({ content: data.content, saving: false });
  });

  const saveRaw = () => run(async () => {
    if (!raw) return;
    setRaw({ ...raw, saving: true });
    await call('/api/file', { method: 'POST', body: JSON.stringify({ path: requirementsPath(setId), content: raw.content }) });
    const { doc: next } = await call<{ doc: RequirementsDoc | null }>(`/api/requirements?${new URLSearchParams({ set: setId })}`, { method: 'GET' });
    onDocChange(next);
    setRaw(null);
  });

  // --- Empty state ---
  if (!adding && requirements.length === 0) {
    return (
      <div className="max-w-xl mx-auto text-center py-16">
        <div className="w-12 h-12 mx-auto rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center"><Video size={22} /></div>
        <h3 className="mt-4 text-sm font-bold text-zinc-900 dark:text-white">No requirements in this list yet</h3>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Import them from a recorded Zoom meeting or an uploaded transcript, or write them by hand.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <button onClick={onImport} className="flex items-center gap-1.5 px-3 py-2 bg-black dark:bg-white text-white dark:text-black rounded-lg text-xs font-semibold hover:opacity-90"><Video size={14} /> Import from meeting</button>
          <button onClick={() => setAdding(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900"><Plus size={14} /> Add manually</button>
        </div>
        {error && <p role="alert" className="mt-3 text-[11px] text-red-600">{error}</p>}
      </div>
    );
  }

  const selectCls = 'px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-xs text-zinc-700 dark:text-zinc-300';

  return (
    <div className="max-w-5xl">
      {/* Summary + toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input aria-label="Search requirements" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search requirements…"
            className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-xs" />
        </div>
        <select aria-label="Filter by status" className={selectCls} value={statusFilter} onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}>
          <option value="all">All statuses ({requirements.length})</option>
          {REQUIREMENT_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]} ({counts[s]})</option>)}
        </select>
        <select aria-label="Filter by priority" className={selectCls} value={priorityFilter} onChange={e => setPriorityFilter(e.target.value as typeof priorityFilter)}>
          <option value="all">All priorities</option>
          {REQUIREMENT_PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
        </select>
        {counts.draft > 0 && (
          <button onClick={acceptAllDrafts} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-zinc-200 dark:border-zinc-800 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10">
            <Check size={13} /> Accept all drafts ({counts.draft})
          </button>
        )}
        <button onClick={openRaw} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900" title="Edit requirements.md directly">
          <FileText size={13} /> Markdown
        </button>
        <button onClick={() => { setAdding(true); setEditingId(null); }} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-black dark:bg-white text-white dark:text-black rounded-lg text-xs font-semibold hover:opacity-90">
          <Plus size={13} /> Add
        </button>
      </div>

      {error && <p role="alert" className="mb-3 text-[11px] text-red-600 dark:text-red-400">{error}</p>}

      {adding && (
        <div className="mb-4 p-4 rounded-xl border border-blue-500/40 bg-white dark:bg-zinc-950">
          <RequirementEditor onSave={add} onCancel={() => setAdding(false)} />
        </div>
      )}

      {/* Grouped by type */}
      {REQUIREMENT_TYPES.map(type => {
        const group = visible.filter(r => r.type === type);
        if (group.length === 0) return null;
        return (
          <section key={type} className="mb-6">
            <h4 className="text-[11px] font-bold uppercase tracking-wide text-zinc-500 mb-2">{TYPE_LABELS[type]} · {group.length}</h4>
            <div className="space-y-2">
              {group.map(r => (
                <article key={r.id} className={`p-4 rounded-xl border bg-white dark:bg-zinc-950 ${r.status === 'rejected' ? 'border-zinc-200/60 dark:border-zinc-800/60 opacity-70' : 'border-zinc-200 dark:border-zinc-800'}`}>
                  {editingId === r.id ? (
                    <RequirementEditor initial={r} onSave={patch => update(r.id, patch)} onCancel={() => setEditingId(null)} />
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[10px] font-mono text-zinc-400">{r.id}</span>
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${PRIORITY_CLS[r.priority]}`}>{PRIORITY_LABELS[r.priority]}</span>
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${STATUS_CLS[r.status]}`}>{STATUS_LABELS[r.status]}</span>
                            {r.feature && (
                              <button
                                onClick={() => onOpenFeature?.(r.feature!)}
                                className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 inline-flex items-center gap-1 hover:underline"
                                title="Created as a feature — open it in Workflow"
                              >
                                <GitBranch size={10} /> {r.feature}
                              </button>
                            )}
                          </div>
                          <h5 className="mt-1 text-sm font-semibold text-zinc-900 dark:text-white">{r.title}</h5>
                        </div>
                        <div className="flex items-center gap-0.5 shrink-0">
                          {r.status !== 'accepted' && (
                            <button onClick={() => update(r.id, { status: 'accepted' })} className="p-1.5 rounded text-zinc-500 hover:text-emerald-600 hover:bg-zinc-100 dark:hover:bg-zinc-900" title="Accept" aria-label={`Accept ${r.id}`}><Check size={14} /></button>
                          )}
                          {r.status !== 'rejected' && (
                            <button onClick={() => update(r.id, { status: 'rejected' })} className="p-1.5 rounded text-zinc-500 hover:text-red-600 hover:bg-zinc-100 dark:hover:bg-zinc-900" title="Reject" aria-label={`Reject ${r.id}`}><X size={14} /></button>
                          )}
                          {r.status !== 'draft' && (
                            <button onClick={() => update(r.id, { status: 'draft' })} className="p-1.5 rounded text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900" title="Back to draft" aria-label={`Mark ${r.id} as draft`}><RotateCcw size={13} /></button>
                          )}
                          <button onClick={() => move(r.id, -1)} className="p-1.5 rounded text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900" title="Move up" aria-label={`Move ${r.id} up`}><ArrowUp size={13} /></button>
                          <button onClick={() => move(r.id, 1)} className="p-1.5 rounded text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900" title="Move down" aria-label={`Move ${r.id} down`}><ArrowDown size={13} /></button>
                          <button onClick={() => { setEditingId(r.id); setAdding(false); }} className="p-1.5 rounded text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900" title="Edit" aria-label={`Edit ${r.id}`}><Pencil size={13} /></button>
                          <button onClick={() => remove(r.id)} className="p-1.5 rounded text-zinc-500 hover:text-red-500 hover:bg-zinc-100 dark:hover:bg-zinc-900" title="Delete" aria-label={`Delete ${r.id}`}><Trash2 size={13} /></button>
                        </div>
                      </div>
                      {r.description && <p className="mt-1.5 text-xs text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap">{r.description}</p>}
                      {r.acceptanceCriteria.length > 0 && (
                        <ul className="mt-2 space-y-0.5">
                          {r.acceptanceCriteria.map((ac, i) => (
                            <li key={i} className="text-[11px] text-zinc-600 dark:text-zinc-400 flex gap-1.5"><span className="text-zinc-400">•</span>{ac}</li>
                          ))}
                        </ul>
                      )}
                      {r.source?.quote && (
                        <p className="mt-2 text-[11px] text-zinc-500 italic flex gap-1.5">
                          <Quote size={11} className="mt-0.5 shrink-0" />
                          <span>
                            {r.source.timestamp && <span className="not-italic font-mono mr-1">[{r.source.timestamp}]</span>}
                            {r.source.speaker && <span className="not-italic font-semibold mr-1">{r.source.speaker}:</span>}
                            “{r.source.quote}”
                          </span>
                        </p>
                      )}
                    </>
                  )}
                </article>
              ))}
            </div>
          </section>
        );
      })}
      {visible.length === 0 && <p className="text-xs text-zinc-500 italic">No requirements match these filters.</p>}

      {/* Undo toast */}
      {undo && (
        <div role="status" className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 rounded-lg bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 shadow-lg text-xs">
          <span>Deleted {undo.requirement.id} · {undo.requirement.title.slice(0, 50)}</span>
          <button onClick={restore} className="font-bold underline">Undo</button>
        </div>
      )}

      {/* Raw markdown editor */}
      {raw && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6" role="dialog" aria-modal="true" aria-label="Edit requirements markdown">
          <div className="w-full max-w-4xl h-[80vh] flex flex-col rounded-xl bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 shadow-xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
              <span className="text-xs font-mono text-zinc-600 dark:text-zinc-400">{requirementsPath(setId)}</span>
              <button onClick={() => setRaw(null)} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-900" aria-label="Close"><X size={14} /></button>
            </div>
            <textarea
              aria-label="requirements.md"
              className="flex-1 p-4 font-mono text-xs bg-transparent text-zinc-900 dark:text-zinc-100 focus:outline-none resize-none"
              value={raw.content}
              onChange={e => setRaw({ ...raw, content: e.target.value })}
              spellCheck={false}
            />
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-zinc-200 dark:border-zinc-800">
              <button onClick={() => setRaw(null)} className="px-3 py-2 rounded-lg text-xs font-semibold border border-zinc-200 dark:border-zinc-800">Cancel</button>
              <button onClick={saveRaw} disabled={raw.saving} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-black dark:bg-white text-white dark:text-black disabled:opacity-50">
                {raw.saving && <Loader2 size={13} className="animate-spin" />} Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RequirementsPanel;
