'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Sparkles, Layers, Loader2, CheckCircle2, AlertTriangle, Plus, Trash2, ArrowRight, GitBranch, Bot } from 'lucide-react';
import { Requirement, RequirementsDoc } from '../domain/models/requirements';
import { AgentConfig, WorkflowState } from '../domain/models/types';
import { FeatureGroup, slugify } from '../domain/services/featureGrouping';
import { stripAnsi } from '../domain/services/CostMeter';
import { readSse } from '../lib/sse';
import { PRIORITY_CLS, PRIORITY_LABELS, TYPE_LABELS } from './requirementLabels';

type Props = {
  isOpen: boolean;
  setId: string;
  doc: RequirementsDoc;
  agentConfig: AgentConfig;
  agentLabel: string; // active agent profile name, e.g. "Codex"
  llmLabel: string | null;
  // Regenerate the spec of an already-created feature instead of creating new ones.
  retryFeature?: string | null;
  onClose: () => void;
  onFinished: (state: WorkflowState | undefined) => void;
  onOpenFeature: (feature: string) => void;
};

type Step = 'select' | 'review' | 'run';
type RunStatus = { feature: string; title: string; state: 'pending' | 'running' | 'ok' | 'failed'; message?: string; log: string };

const MAX_LOG = 6000;
// Claude Code's first-run confirmation for --permission-mode bypassPermissions
// (PTY output often loses the spaces, hence \s*).
const BYPASS_PROMPT = /bypass\s*permissions\s*mode[\s\S]*accept/i;

export const CreateFeaturesModal: React.FC<Props> = ({
  isOpen, setId, doc, agentConfig, agentLabel, llmLabel, retryFeature, onClose, onFinished, onOpenFeature,
}) => {
  // Won't-have items were explicitly ruled out in the meeting: never built.
  const candidates = useMemo(() => doc.requirements.filter(r => !r.feature && r.status !== 'rejected' && r.priority !== 'wont'), [doc]);
  const wontCount = doc.requirements.filter(r => !r.feature && r.status !== 'rejected' && r.priority === 'wont').length;
  const byId = useMemo(() => new Map(doc.requirements.map(r => [r.id, r])), [doc]);

  const [step, setStep] = useState<Step>('select');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<'ai' | 'single'>('ai');
  const [groups, setGroups] = useState<FeatureGroup[]>([]);
  const [unassigned, setUnassigned] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunStatus[]>([]);
  const [finished, setFinished] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setFinished(false);
    setRuns([]);
    if (retryFeature) {
      setStep('run');
      run(null, retryFeature);
    } else {
      setStep('select');
      setSelected(new Set(candidates.filter(r => r.status === 'accepted').map(r => r.id)));
      setMode('ai');
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isOpen) return null;

  const close = () => {
    abortRef.current?.abort();
    onClose();
  };

  // ---------- step 1 → 2 ----------
  const toReview = async () => {
    setError(null);
    const ids = candidates.filter(r => selected.has(r.id)).map(r => r.id);
    if (ids.length === 0) return setError('Select at least one requirement.');
    if (mode === 'single') {
      const title = doc.meta.title || doc.meta.meetingTopic || 'New feature';
      setGroups([{ name: slugify(title) || 'feature', title, requirementIds: ids }]);
      setUnassigned([]);
      setStep('review');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/requirements/grouping', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ set: setId, ids }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not get a suggestion.');
      setGroups(data.groups);
      setUnassigned(data.unassigned);
      setStep('review');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // ---------- step 2 editing ----------
  const updateGroup = (i: number, patch: Partial<FeatureGroup>) =>
    setGroups(gs => gs.map((g, j) => (j === i ? { ...g, ...patch } : g)));

  // target: group index, -1 = unassigned, 'new' = a new feature
  const moveRequirement = (id: string, target: number | 'new') => {
    const r = byId.get(id);
    setGroups(gs => {
      let next = gs.map(g => ({ ...g, requirementIds: g.requirementIds.filter(x => x !== id) }));
      if (target === 'new') next = [...next, { name: slugify(r?.title ?? 'feature'), title: r?.title ?? 'New feature', requirementIds: [id] }];
      else if (target >= 0) next = next.map((g, j) => (j === target ? { ...g, requirementIds: [...g.requirementIds, id] } : g));
      return next;
    });
    setUnassigned(u => (target === -1 ? [...u.filter(x => x !== id), id] : u.filter(x => x !== id)));
  };

  const removeGroup = (i: number) => {
    setUnassigned(u => [...u, ...groups[i].requirementIds]);
    setGroups(gs => gs.filter((_, j) => j !== i));
  };

  const reviewProblem = groups.length === 0
    ? 'Add at least one feature.'
    : groups.find(g => g.requirementIds.length === 0)
      ? 'Every feature needs at least one requirement (remove empty ones).'
      : groups.find(g => !slugify(g.name || g.title))
        ? 'Every feature needs a name.'
        : null;

  // ---------- step 3 ----------
  const run = async (groupsToCreate: FeatureGroup[] | null, feature?: string) => {
    setStep('run');
    setError(null);
    setFinished(false);
    setRuns(feature ? [{ feature, title: feature, state: 'running', log: '' }] : (groupsToCreate ?? []).map(g => ({ feature: '', title: g.title, state: 'pending', log: '' })));
    const controller = new AbortController();
    abortRef.current = controller;
    let finalState: WorkflowState | undefined;
    try {
      const res = await fetch('/api/requirements/features', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(feature ? { set: setId, feature, agentConfig } : { set: setId, groups: groupsToCreate, agentConfig }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      await readSse(res, (name, data) => {
        if (name === 'start') {
          setRuns(rs => rs.map((r, i) => (i === data.index ? { ...r, feature: data.feature, title: feature ? r.title : data.title, state: 'running' } : r)));
        } else if (name === 'log') {
          setRuns(rs => rs.map(r => (r.feature === data.feature ? { ...r, log: (r.log + stripAnsi(data.text)).slice(-MAX_LOG) } : r)));
        } else if (name === 'done') {
          setRuns(rs => rs.map(r => (r.feature === data.feature ? { ...r, state: data.ok ? 'ok' : 'failed', message: data.message } : r)));
        } else if (name === 'complete') {
          finalState = data.state;
        } else if (name === 'error') {
          setError(data.message);
        }
      });
    } catch (err: any) {
      if (err.name !== 'AbortError') setError(err.message);
    } finally {
      setFinished(true);
      onFinished(finalState);
    }
  };

  const selectedCount = candidates.filter(r => selected.has(r.id)).length;
  const radioCls = (active: boolean) => `flex-1 text-left p-3 rounded-lg border transition ${active ? 'border-blue-500 bg-blue-500/5' : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900'}`;
  const inputCls = 'px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/40';

  const ReqLine = ({ r }: { r: Requirement }) => (
    <span className="min-w-0 flex items-center gap-1.5">
      <span className="text-[10px] font-mono text-zinc-400 shrink-0">{r.id}</span>
      <span className={`text-[9px] font-semibold px-1 py-0.5 rounded shrink-0 ${PRIORITY_CLS[r.priority]}`}>{PRIORITY_LABELS[r.priority]}</span>
      <span className="text-xs text-zinc-800 dark:text-zinc-200 truncate">{r.title}</span>
      {r.type !== 'functional' && <span className="text-[10px] text-zinc-400 shrink-0">· {TYPE_LABELS[r.type]}</span>}
    </span>
  );

  const MoveSelect = ({ id, current }: { id: string; current: number }) => (
    <select
      aria-label={`Move ${id}`}
      value={current}
      onChange={e => moveRequirement(id, e.target.value === 'new' ? 'new' : Number(e.target.value))}
      className="text-[10px] px-1.5 py-1 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-zinc-600 dark:text-zinc-400 shrink-0 max-w-[9rem]"
    >
      {groups.map((g, j) => <option key={j} value={j}>{j === current ? 'In this feature' : `Move to: ${g.title || g.name}`}</option>)}
      <option value="new">Move to: new feature</option>
      <option value={-1}>{current === -1 ? 'Not included' : 'Leave out'}</option>
    </select>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6" role="dialog" aria-modal="true" aria-labelledby="create-features-title">
      <div className="w-full max-w-3xl max-h-[88vh] flex flex-col rounded-xl bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 dark:border-zinc-800">
          <div>
            <h3 id="create-features-title" className="text-sm font-bold text-zinc-900 dark:text-white flex items-center gap-2">
              <GitBranch size={15} /> {retryFeature ? `Generate spec for ${retryFeature}` : 'Create features from requirements'}
            </h3>
            <p className="text-[11px] text-zinc-500 mt-0.5 flex items-center gap-1.5">
              {!retryFeature && <>
                <span className={step === 'select' ? 'font-semibold text-zinc-800 dark:text-zinc-200' : ''}>1 Select</span><ArrowRight size={10} />
                <span className={step === 'review' ? 'font-semibold text-zinc-800 dark:text-zinc-200' : ''}>2 Review features</span><ArrowRight size={10} />
                <span className={step === 'run' ? 'font-semibold text-zinc-800 dark:text-zinc-200' : ''}>3 Generate specs</span>
                <span className="mx-1">·</span>
              </>}
              <Bot size={11} /> specs written by Spec Kit via <b>{agentLabel}</b>
            </p>
          </div>
          <button onClick={close} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-900" aria-label="Close"><X size={15} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {error && <p role="alert" className="text-[11px] rounded-lg p-3 bg-red-500/10 text-red-800 dark:text-red-300 flex gap-1.5"><AlertTriangle size={13} className="shrink-0 mt-px" />{error}</p>}

          {step === 'select' && (
            <>
              {candidates.length === 0 ? (
                <p className="text-xs text-zinc-500">Every requirement in this list is already part of a feature (or rejected).</p>
              ) : (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">
                      Requirements to build ({selectedCount} selected)
                      {wontCount > 0 && <span className="font-normal text-zinc-400"> · {wontCount} won’t-have left out</span>}
                    </p>
                    <div className="flex gap-2 text-[11px]">
                      <button className="underline text-zinc-500" onClick={() => setSelected(new Set(candidates.filter(r => r.status === 'accepted').map(r => r.id)))}>Accepted only</button>
                      <button className="underline text-zinc-500" onClick={() => setSelected(new Set(candidates.map(r => r.id)))}>All</button>
                      <button className="underline text-zinc-500" onClick={() => setSelected(new Set())}>None</button>
                    </div>
                  </div>
                  <ul className="space-y-1 max-h-64 overflow-y-auto pr-1">
                    {candidates.map(r => (
                      <li key={r.id}>
                        <label className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-50 dark:hover:bg-zinc-900 cursor-pointer">
                          <input type="checkbox" checked={selected.has(r.id)} onChange={e => setSelected(s => { const n = new Set(s); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} className="w-3.5 h-3.5" />
                          <ReqLine r={r} />
                          {r.status === 'draft' && <span className="text-[10px] text-amber-600 shrink-0">draft</span>}
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="flex gap-3" role="radiogroup" aria-label="How to split into features">
                <button role="radio" aria-checked={mode === 'ai'} className={radioCls(mode === 'ai')} onClick={() => setMode('ai')} disabled={!llmLabel}>
                  <span className="text-xs font-semibold flex items-center gap-1.5"><Sparkles size={13} /> Let AI suggest features</span>
                  <span className="block text-[11px] text-zinc-500 mt-0.5">{llmLabel ? `Groups related requirements (${llmLabel}). You review before anything is created.` : 'Add an AI key in Settings to use this.'}</span>
                </button>
                <button role="radio" aria-checked={mode === 'single'} className={radioCls(mode === 'single')} onClick={() => setMode('single')}>
                  <span className="text-xs font-semibold flex items-center gap-1.5"><Layers size={13} /> One feature for all</span>
                  <span className="block text-[11px] text-zinc-500 mt-0.5">Everything selected becomes a single spec.</span>
                </button>
              </div>
            </>
          )}

          {step === 'review' && (
            <>
              <p className="text-[11px] text-zinc-500">Each feature gets its own <span className="font-mono">specs/NNN-name/</span> folder and spec. Rename, move requirements between features, or leave some out.</p>
              {groups.map((g, i) => (
                <section key={i} className="p-3 rounded-lg border border-zinc-200 dark:border-zinc-800">
                  <div className="flex items-center gap-2">
                    <input aria-label={`Feature ${i + 1} title`} value={g.title} onChange={e => updateGroup(i, { title: e.target.value })} className={`${inputCls} flex-1 font-semibold`} />
                    <span className="text-[10px] font-mono text-zinc-400">specs/NNN-</span>
                    <input aria-label={`Feature ${i + 1} folder name`} value={g.name} onChange={e => updateGroup(i, { name: e.target.value })} onBlur={e => updateGroup(i, { name: slugify(e.target.value) })} className={`${inputCls} w-44 font-mono`} />
                    <button onClick={() => removeGroup(i)} className="p-1.5 rounded text-zinc-400 hover:text-red-500" title="Remove feature" aria-label={`Remove feature ${i + 1}`}><Trash2 size={13} /></button>
                  </div>
                  {g.summary && <p className="mt-1.5 text-[11px] text-zinc-500">{g.summary}</p>}
                  <ul className="mt-2 space-y-1">
                    {g.requirementIds.map(id => byId.get(id) && (
                      <li key={id} className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-zinc-50 dark:bg-zinc-900/60">
                        <ReqLine r={byId.get(id)!} /><MoveSelect id={id} current={i} />
                      </li>
                    ))}
                    {g.requirementIds.length === 0 && <li className="text-[11px] text-amber-600 px-2">No requirements — move some here or remove this feature.</li>}
                  </ul>
                </section>
              ))}
              {unassigned.length > 0 && (
                <section className="p-3 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700">
                  <p className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 mb-1.5">Not included ({unassigned.length})</p>
                  <ul className="space-y-1">
                    {unassigned.map(id => byId.get(id) && (
                      <li key={id} className="flex items-center justify-between gap-2 px-2 py-1"><ReqLine r={byId.get(id)!} /><MoveSelect id={id} current={-1} /></li>
                    ))}
                  </ul>
                </section>
              )}
              <button onClick={() => setGroups(gs => [...gs, { name: 'new-feature', title: 'New feature', requirementIds: [] }])} className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 hover:underline"><Plus size={12} /> Add feature</button>
            </>
          )}

          {step === 'run' && (
            <>
              {!finished && runs.some(r => r.state === 'running' && BYPASS_PROMPT.test(r.log)) && (
                <p role="alert" className="text-[11px] rounded-lg p-3 bg-amber-500/10 text-amber-800 dark:text-amber-300 flex gap-1.5">
                  <AlertTriangle size={13} className="shrink-0 mt-px" />
                  <span>Claude is waiting for its one-time “Bypass Permissions mode” confirmation. Run <code className="font-mono">claude --dangerously-skip-permissions</code> once in your own terminal and choose “Yes, I accept”, then close this dialog and use ↻ to regenerate the spec.</span>
                </p>
              )}
              {!finished && <p className="text-[11px] text-zinc-500">{agentLabel} is writing each spec with Spec Kit. This can take a few minutes per feature; closing this dialog doesn’t stop it.</p>}
              {runs.map((r, i) => (
                <section key={i} className="rounded-lg border border-zinc-200 dark:border-zinc-800">
                  <div className="flex items-center justify-between px-3 py-2">
                    <span className="flex items-center gap-2 text-xs">
                      {r.state === 'running' ? <Loader2 size={13} className="animate-spin text-blue-500" /> : r.state === 'ok' ? <CheckCircle2 size={13} className="text-emerald-500" /> : r.state === 'failed' ? <AlertTriangle size={13} className="text-red-500" /> : <span className="w-3 h-3 rounded-full border border-zinc-300" />}
                      <span className="font-semibold text-zinc-900 dark:text-white">{r.title}</span>
                      {finished && r.state === 'pending' && <span className="text-[10px] text-zinc-500">Not created</span>}
                      {r.feature && <span className="font-mono text-[10px] text-zinc-400">specs/{r.feature}</span>}
                    </span>
                    {r.state === 'ok' && <button onClick={() => onOpenFeature(r.feature)} className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline">Review spec →</button>}
                  </div>
                  {r.message && <p className={`px-3 pb-2 text-[11px] ${r.state === 'ok' ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>{r.message}</p>}
                  {r.log && r.state !== 'pending' && (
                    <pre className="mx-3 mb-3 p-2 max-h-40 overflow-y-auto rounded bg-zinc-950 text-zinc-300 text-[10px] leading-snug whitespace-pre-wrap">{r.log.split('\n').slice(-40).join('\n')}</pre>
                  )}
                </section>
              ))}
            </>
          )}
        </div>

        <div className="flex justify-between gap-2 px-5 py-4 border-t border-zinc-200 dark:border-zinc-800">
          <div>
            {step === 'review' && <button onClick={() => setStep('select')} className="px-3 py-2 rounded-lg text-xs font-semibold text-zinc-600 dark:text-zinc-400 hover:underline">← Back</button>}
          </div>
          <div className="flex gap-2">
            <button onClick={close} className="px-3 py-2 rounded-lg text-xs font-semibold border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900">
              {step === 'run' && finished ? 'Done' : 'Close'}
            </button>
            {step === 'select' && (
              <button onClick={toReview} disabled={busy || selectedCount === 0} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-black dark:bg-white text-white dark:text-black hover:opacity-90 disabled:opacity-40">
                {busy && <Loader2 size={13} className="animate-spin" />} {busy ? 'Suggesting features…' : 'Next'}
              </button>
            )}
            {step === 'review' && (
              <button onClick={() => run(groups)} disabled={!!reviewProblem} title={reviewProblem ?? undefined} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-black dark:bg-white text-white dark:text-black hover:opacity-90 disabled:opacity-40">
                <GitBranch size={13} /> Create {groups.length} feature{groups.length === 1 ? '' : 's'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CreateFeaturesModal;
