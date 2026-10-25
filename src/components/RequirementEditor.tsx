'use client';

import React, { useState } from 'react';
import {
  Requirement,
  RequirementInput,
  REQUIREMENT_PRIORITIES,
  REQUIREMENT_STATUSES,
  REQUIREMENT_TYPES,
} from '../domain/models/requirements';
import { PRIORITY_LABELS, STATUS_LABELS, TYPE_LABELS } from './requirementLabels';

type Props = {
  initial?: Requirement;
  onSave: (input: RequirementInput) => Promise<void> | void;
  onCancel: () => void;
};

const inputCls = 'w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40';
const labelCls = 'block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 mb-1';

export const RequirementEditor: React.FC<Props> = ({ initial, onSave, onCancel }) => {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [type, setType] = useState(initial?.type ?? 'functional');
  const [priority, setPriority] = useState(initial?.priority ?? 'should');
  const [status, setStatus] = useState(initial?.status ?? (initial ? 'draft' : 'accepted'));
  const [description, setDescription] = useState(initial?.description ?? '');
  const [criteria, setCriteria] = useState((initial?.acceptanceCriteria ?? []).join('\n'));
  const [timestamp, setTimestamp] = useState(initial?.source?.timestamp ?? '');
  const [speaker, setSpeaker] = useState(initial?.source?.speaker ?? '');
  const [quote, setQuote] = useState(initial?.source?.quote ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Give the requirement a title.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({
        title: title.trim(),
        type,
        priority,
        status,
        description,
        acceptanceCriteria: criteria.split('\n').map(l => l.replace(/^\s*[-*]\s*/, '').trim()).filter(Boolean),
        source: { timestamp, speaker, quote },
      });
    } catch (err: any) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} onKeyDown={e => { if (e.key === 'Escape') onCancel(); }} className="space-y-3">
      <div>
        <label className={labelCls} htmlFor="req-title">Title</label>
        <input id="req-title" autoFocus className={inputCls} value={title} onChange={e => setTitle(e.target.value)} placeholder="Users can reset their password by email" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={labelCls} htmlFor="req-type">Type</label>
          <select id="req-type" className={inputCls} value={type} onChange={e => setType(e.target.value as typeof type)}>
            {REQUIREMENT_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="req-priority">Priority</label>
          <select id="req-priority" className={inputCls} value={priority} onChange={e => setPriority(e.target.value as typeof priority)}>
            {REQUIREMENT_PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="req-status">Status</label>
          <select id="req-status" className={inputCls} value={status} onChange={e => setStatus(e.target.value as typeof status)}>
            {REQUIREMENT_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className={labelCls} htmlFor="req-desc">Description</label>
        <textarea id="req-desc" rows={3} className={inputCls} value={description} onChange={e => setDescription(e.target.value)} />
      </div>
      <div>
        <label className={labelCls} htmlFor="req-ac">Acceptance criteria <span className="font-normal text-zinc-400">(one per line)</span></label>
        <textarea id="req-ac" rows={3} className={`${inputCls} font-mono`} value={criteria} onChange={e => setCriteria(e.target.value)} />
      </div>
      <details open={!!(timestamp || speaker || quote)}>
        <summary className="cursor-pointer text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">Source in meeting</summary>
        <div className="mt-2 grid grid-cols-4 gap-3">
          <input aria-label="Timestamp" className={`${inputCls} font-mono`} placeholder="00:12:41" value={timestamp} onChange={e => setTimestamp(e.target.value)} />
          <input aria-label="Speaker" className={inputCls} placeholder="Speaker" value={speaker} onChange={e => setSpeaker(e.target.value)} />
          <input aria-label="Quote" className={`${inputCls} col-span-2`} placeholder="What was said" value={quote} onChange={e => setQuote(e.target.value)} />
        </div>
      </details>
      {error && <p role="alert" className="text-[11px] text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="px-3 py-2 rounded-lg text-xs font-semibold border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900">Cancel</button>
        <button type="submit" disabled={saving} className="px-3 py-2 rounded-lg text-xs font-semibold bg-black dark:bg-white text-white dark:text-black hover:opacity-90 disabled:opacity-50">
          {initial ? 'Save changes' : 'Add requirement'}
        </button>
      </div>
    </form>
  );
};

export default RequirementEditor;
