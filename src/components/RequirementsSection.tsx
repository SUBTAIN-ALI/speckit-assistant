'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardList, Settings, Video, Plus, Check, AlertTriangle, X, ArrowLeft, GitBranch, Trash2, RefreshCw, FileText } from 'lucide-react';
import { AgentConfig, WorkflowState } from '../domain/models/types';
import { IntegrationsView, LLM_PROVIDER_LABELS } from '../domain/models/credentials';
import { RequirementSetSummary, RequirementsDoc } from '../domain/models/requirements';
import { RequirementsPanel } from './RequirementsPanel';
import { MeetingImportModal } from './MeetingImportModal';
import { IntegrationsSettings } from './IntegrationsSettings';
import { CreateFeaturesModal } from './CreateFeaturesModal';

type Props = {
  agentConfig: AgentConfig;
  agentLabel: string;
  onStateChange: (state: WorkflowState) => void;
  onOpenFeature: (feature: string) => void;
  onNavigate?: (section: 'extensions' | 'mcp' | 'agents') => void;
};

type Readiness = {
  engine: 'agent' | 'direct';
  agentLabel: string | null;
  agent: { uploadProblems: string[]; zoomProblems: string[]; zoomServer: string | null };
  direct: { ready: boolean; provider: string; model: string };
};

// Which section can fix a readiness problem (problems name the section).
const fixTarget = (problem: string): 'extensions' | 'mcp' | 'agents' | null =>
  /Extensions/.test(problem) ? 'extensions' : /MCP Tools/.test(problem) ? 'mcp' : /Agents/.test(problem) ? 'agents' : null;

// Top-level "Requirements" section — the front of the SDD flow:
//   meeting (Zoom / transcript) → requirement list → review → Create features
//   → Spec Kit writes each spec → Workflow (clarify → plan → tasks → implement).
export const RequirementsSection: React.FC<Props> = ({ agentConfig, agentLabel, onStateChange, onOpenFeature, onNavigate }) => {
  const [sets, setSets] = useState<RequirementSetSummary[]>([]);
  const [setId, setSetId] = useState<string | null>(null);
  const [view, setView] = useState<IntegrationsView | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [tab, setTab] = useState<'requirements' | 'settings'>('requirements');
  const [doc, setDoc] = useState<RequirementsDoc | null>(null);
  const [loading, setLoading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [retryFeature, setRetryFeature] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [creatingList, setCreatingList] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const loadSets = useCallback(async () => {
    try {
      const res = await fetch('/api/requirements/sets');
      const data = await res.json();
      if (res.ok) setSets(data.sets);
    } catch {
      // keep the current list
    }
  }, []);

  const loadDoc = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/requirements?${new URLSearchParams({ set: id })}`);
      const data = await res.json();
      setDoc(res.ok ? data.doc : null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSets();
    fetch('/api/settings/integrations').then(r => r.json()).then(v => { if (!v.error) setView(v); }).catch(() => {});
  }, [loadSets]);

  const loadReadiness = useCallback(() => {
    fetch('/api/requirements/readiness').then(r => r.json()).then(v => { if (!v.error) setReadiness(v); }).catch(() => {});
  }, []);
  // Re-check whenever settings change (engine, keys, Zoom) or the tab is shown.
  useEffect(() => { loadReadiness(); }, [view, tab, loadReadiness]);

  // Keep a valid selection (newest list by default).
  useEffect(() => {
    if (!setId || !sets.some(s => s.id === setId)) setSetId(sets[0]?.id ?? null);
  }, [sets]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setConfirmDelete(false);
    if (setId) loadDoc(setId);
    else setDoc(null);
  }, [setId, loadDoc]);

  // Outcome of the Zoom OAuth redirect (?zoom=connected|error&message=…).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const zoom = params.get('zoom');
    if (!zoom) return;
    setTab('settings');
    setBanner(zoom === 'connected'
      ? { ok: true, text: 'Zoom connected. You can now import meetings.' }
      : { ok: false, text: params.get('message') || 'Zoom sign-in failed.' });
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  // Pick up edits made to requirements.md outside the app.
  useEffect(() => {
    const onFocus = () => { loadReadiness(); if (setId && tab === 'requirements') { loadDoc(setId); loadSets(); } };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [setId, tab, loadDoc, loadSets, loadReadiness]);

  const onDocChange = (next: RequirementsDoc | null) => {
    setDoc(next);
    loadSets();
  };

  const createList = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/requirements/sets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: newTitle }),
    });
    const data = await res.json();
    if (!res.ok) return setBanner({ ok: false, text: data.error || 'Could not create the list.' });
    setNewTitle('');
    setCreatingList(false);
    await loadSets();
    setSetId(data.id);
  };

  const deleteList = async () => {
    if (!setId) return;
    const res = await fetch(`/api/requirements/sets?${new URLSearchParams({ set: setId })}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return setBanner({ ok: false, text: data.error || 'Could not delete the list.' });
    }
    setConfirmDelete(false);
    setSetId(null);
    await loadSets();
  };

  // Who extracts and groups: the active agent (meetings extension) or the
  // direct API. null = not ready yet (the status panel says why).
  const agentMode = readiness?.engine !== 'direct';
  const llmLabel = agentMode
    ? (readiness && readiness.agent.uploadProblems.length === 0 ? `${readiness.agentLabel ?? agentLabel} (agent)` : null)
    : (view && view.llm.configured[view.llm.provider]
      ? `${LLM_PROVIDER_LABELS[view.llm.provider]} · ${view.llm.models[view.llm.provider]}`
      : null);
  const zoomReady = !!view?.zoom.connected && (!agentMode || (readiness?.agent.zoomProblems.length ?? 1) === 0);
  const problems = agentMode && readiness
    ? [...new Set([...readiness.agent.uploadProblems, ...readiness.agent.zoomProblems])]
    : [];

  const current = sets.find(s => s.id === setId);
  const buildable = doc?.requirements.filter(r => !r.feature && r.status === 'accepted' && r.priority !== 'wont').length ?? 0;
  const features = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of doc?.requirements ?? []) if (r.feature) m.set(r.feature, (m.get(r.feature) ?? 0) + 1);
    return [...m.entries()];
  }, [doc]);

  const afterFeatures = async (state: WorkflowState | undefined) => {
    if (state) onStateChange(state);
    else {
      const res = await fetch('/api/state');
      if (res.ok) onStateChange(await res.json());
    }
    if (setId) await loadDoc(setId);
    await loadSets();
  };

  const btn = 'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition disabled:opacity-40';
  const secondary = `${btn} border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900`;
  const primary = `${btn} bg-black dark:bg-white text-white dark:text-black hover:opacity-90`;

  if (tab === 'settings') {
    return (
      <div className="w-full h-full overflow-y-auto px-8 py-6">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
          <div>
            <h2 className="text-lg font-bold text-zinc-900 dark:text-white flex items-center gap-2"><Settings size={18} /> Requirements settings</h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">Your AI provider key and Zoom app. Everything stays on this computer.</p>
          </div>
          <button onClick={() => { setTab('requirements'); setBanner(null); }} className={secondary}><ArrowLeft size={14} /> Back to requirements</button>
        </div>
        {banner && <Banner banner={banner} onDismiss={() => setBanner(null)} />}
        <IntegrationsSettings view={view} onChange={setView} />
      </div>
    );
  }

  return (
    <div className="w-full h-full flex overflow-hidden">
      {/* Requirement lists (one per meeting) */}
      <aside className="w-64 shrink-0 border-r border-zinc-200 dark:border-zinc-800 overflow-y-auto p-3 bg-zinc-50/50 dark:bg-zinc-950">
        <div className="flex items-center justify-between px-1 mb-2">
          <span className="text-[11px] font-bold uppercase tracking-wide text-zinc-500">Meetings & lists</span>
          <button onClick={() => setCreatingList(c => !c)} className="p-1 rounded text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100" title="New list (write requirements by hand)" aria-label="New list"><Plus size={14} /></button>
        </div>
        {creatingList && (
          <form onSubmit={createList} className="mb-2 flex gap-1">
            <input autoFocus aria-label="New list name" value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="List name"
              className="flex-1 min-w-0 px-2 py-1.5 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-xs" />
            <button type="submit" className="px-2 rounded border border-zinc-200 dark:border-zinc-800" aria-label="Create list"><Check size={12} /></button>
          </form>
        )}
        <button onClick={() => setImportOpen(true)} className="w-full mb-3 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-black dark:bg-white text-white dark:text-black hover:opacity-90">
          <Video size={13} /> Import from meeting
        </button>
        <ul className="space-y-1">
          {sets.map(s => (
            <li key={s.id}>
              <button
                onClick={() => setSetId(s.id)}
                className={`w-full text-left px-2.5 py-2 rounded-lg transition ${s.id === setId ? 'bg-white dark:bg-zinc-900 shadow-sm border border-zinc-200 dark:border-zinc-800' : 'hover:bg-zinc-100 dark:hover:bg-zinc-900 border border-transparent'}`}
              >
                <span className="flex items-center gap-1.5 text-xs font-semibold text-zinc-900 dark:text-white truncate">
                  {s.source === 'zoom' ? <Video size={11} className="shrink-0 text-blue-500" /> : s.source === 'upload' ? <FileText size={11} className="shrink-0 text-zinc-400" /> : <ClipboardList size={11} className="shrink-0 text-zinc-400" />}
                  <span className="truncate">{s.title}</span>
                </span>
                <span className="block text-[10px] text-zinc-500 mt-0.5">
                  {s.id.slice(0, 10)} · {s.total} req · {s.accepted} accepted{s.linked > 0 ? ` · ${s.linked} → features` : ''}
                </span>
              </button>
            </li>
          ))}
          {sets.length === 0 && <li className="text-[11px] text-zinc-500 px-1">No requirement lists yet. Import a meeting to start.</li>}
        </ul>
      </aside>

      {/* Selected list */}
      <div className="flex-1 overflow-y-auto px-8 py-6 min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-zinc-900 dark:text-white flex items-center gap-2"><ClipboardList size={18} /> <span className="truncate">{current?.title ?? 'Requirements'}</span></h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              {current?.meetingTopic && current.meetingTopic !== current.title ? `${current.meetingTopic} · ` : ''}
              Review and accept requirements, then create Spec Kit features from them.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {setId && (confirmDelete ? (
              <span className="flex items-center gap-1.5 text-[11px]">
                Delete this list and its transcript?
                <button onClick={deleteList} className="px-2 py-1 rounded bg-red-600 text-white font-semibold">Delete</button>
                <button onClick={() => setConfirmDelete(false)} className="px-2 py-1 rounded border border-zinc-200 dark:border-zinc-800">Cancel</button>
              </span>
            ) : (
              <button onClick={() => setConfirmDelete(true)} className="p-2 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-zinc-100 dark:hover:bg-zinc-900" title="Delete list" aria-label="Delete list"><Trash2 size={14} /></button>
            ))}
            <button onClick={() => setTab('settings')} className={secondary}><Settings size={14} /> Settings</button>
            <button
              onClick={() => { setRetryFeature(null); setCreateOpen(true); }}
              disabled={!doc || buildable === 0}
              title={buildable === 0 ? 'Accept at least one requirement that isn’t already in a feature' : undefined}
              className={primary}
            >
              <GitBranch size={14} /> Create features{buildable > 0 ? ` (${buildable})` : ''}
            </button>
          </div>
        </div>

        {banner && <Banner banner={banner} onDismiss={() => setBanner(null)} />}

        {view && readiness && (problems.length > 0 || !llmLabel || !view.zoom.connected) && (
          <div className="mb-4 text-[11px] text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-900/60 rounded-lg p-3 space-y-1">
            {agentMode
              ? <p className="font-semibold text-zinc-700 dark:text-zinc-300">Requirements are extracted by your agent ({readiness.agentLabel ?? agentLabel}) with the Meeting Requirements extension.</p>
              : !llmLabel && <p>No AI provider key yet for direct mode.</p>}
            {problems.map(p => {
              const target = fixTarget(p);
              return (
                <p key={p} className="flex items-start gap-1.5">
                  <AlertTriangle size={11} className="mt-0.5 shrink-0 text-amber-500" />
                  <span>{p}{target && onNavigate && <> <button onClick={() => onNavigate(target)} className="underline font-semibold">Open {target === 'mcp' ? 'MCP Tools' : target === 'agents' ? 'Agents' : 'Extensions'}</button></>}</span>
                </p>
              );
            })}
            {!view.zoom.connected && <p>Zoom isn’t connected — you can still import uploaded transcripts.</p>}
            <button onClick={() => setTab('settings')} className="underline font-semibold">Open settings</button>
          </div>
        )}

        {features.length > 0 && (
          <div className="mb-5 p-3 rounded-xl border border-indigo-500/30 bg-indigo-500/5">
            <p className="text-[11px] font-bold text-indigo-800 dark:text-indigo-300 mb-2 flex items-center gap-1.5"><GitBranch size={12} /> Features created from this list</p>
            <ul className="flex flex-wrap gap-2">
              {features.map(([f, n]) => (
                <li key={f} className="flex items-center gap-1 text-[11px] bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg pl-2.5 pr-1 py-1">
                  <button onClick={() => onOpenFeature(f)} className="font-mono font-semibold text-zinc-800 dark:text-zinc-200 hover:underline" title="Open in Workflow">{f}</button>
                  <span className="text-zinc-400">· {n} req</span>
                  <button onClick={() => { setRetryFeature(f); setCreateOpen(true); }} className="ml-1 p-1 rounded text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100" title="Generate the spec again from these requirements" aria-label={`Regenerate spec for ${f}`}><RefreshCw size={11} /></button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!setId ? (
          <div className="max-w-md mx-auto text-center py-16">
            <div className="w-12 h-12 mx-auto rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center"><Video size={22} /></div>
            <p className="mt-4 text-sm font-semibold text-zinc-900 dark:text-white">Start from a meeting</p>
            <p className="text-xs text-zinc-500 mt-1">Import a Zoom meeting or a transcript; the requirements discussed become an editable list you can turn into features.</p>
            <button onClick={() => setImportOpen(true)} className={`${primary} mx-auto mt-4`}><Video size={14} /> Import from meeting</button>
          </div>
        ) : loading && !doc ? (
          <p className="text-xs text-zinc-500">Loading…</p>
        ) : (
          <RequirementsPanel setId={setId} doc={doc} onDocChange={onDocChange} onImport={() => setImportOpen(true)} onOpenFeature={onOpenFeature} />
        )}
      </div>

      <MeetingImportModal
        isOpen={importOpen}
        zoomConnected={zoomReady}
        llmLabel={llmLabel}
        onClose={() => setImportOpen(false)}
        onImported={async (id, d) => { await loadSets(); setSetId(id); setDoc(d); }}
        onOpenSettings={() => { setImportOpen(false); setTab('settings'); }}
      />

      {doc && setId && (
        <CreateFeaturesModal
          isOpen={createOpen}
          setId={setId}
          doc={doc}
          agentConfig={agentConfig}
          agentLabel={agentLabel}
          llmLabel={llmLabel}
          retryFeature={retryFeature}
          onClose={() => { setCreateOpen(false); setRetryFeature(null); }}
          onFinished={afterFeatures}
          onOpenFeature={f => { setCreateOpen(false); onOpenFeature(f); }}
        />
      )}
    </div>
  );
};

const Banner: React.FC<{ banner: { ok: boolean; text: string }; onDismiss: () => void }> = ({ banner, onDismiss }) => (
  <div role={banner.ok ? 'status' : 'alert'} className={`mb-4 flex items-start justify-between gap-3 text-xs rounded-lg p-3 ${banner.ok ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300' : 'bg-red-500/10 text-red-800 dark:text-red-300'}`}>
    <span className="flex gap-1.5">{banner.ok ? <Check size={14} /> : <AlertTriangle size={14} />}{banner.text}</span>
    <button onClick={onDismiss} aria-label="Dismiss"><X size={13} /></button>
  </div>
);

export default RequirementsSection;
