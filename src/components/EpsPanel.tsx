'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { EPS_CHECKS, EPS_ENDPOINTS, EPS_STAGES, EpsBinding, EpsEnvironment, EpsRequirement, EpsState } from '../domain/models/eps';

type View = EpsState & { configured: boolean };
type Props = { onBack: () => void; onOpenList: (setId: string) => void };
const button = 'px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40';
const field = 'w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950';

async function request(body?: Record<string, unknown>, method = 'POST') {
  const res = await fetch('/api/eps', body ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'EPS request failed.');
  return data;
}

export function EpsPanel({ onBack, onOpenList }: Props) {
  const [view, setView] = useState<View | null>(null);
  const [environment, setEnvironment] = useState<EpsEnvironment>('staging');
  const [enabled, setEnabled] = useState(false);
  const [token, setToken] = useState('');
  const [available, setAvailable] = useState<EpsRequirement[]>([]);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ error?: boolean; text: string } | null>(null);
  const refresh = useCallback(async () => { setView(await request()); }, []);
  useEffect(() => {
    let live = true;
    request().then((state: View) => {
      if (!live) return;
      setView(state); setEnvironment(state.environment); setEnabled(state.enabled);
    }).catch(e => { if (live) setNotice({ error: true, text: e.message }); });
    // Reads cached backend state; EPS itself is polled by the server worker.
    const timer = setInterval(() => { request().then(state => { if (live) setView(state); }).catch(() => {}); }, 15_000);
    return () => { live = false; clearInterval(timer); };
  }, []);
  const act = async (action: () => Promise<void>) => {
    setBusy(true); setNotice(null);
    try { await action(); }
    catch (error) { setNotice({ error: true, text: error instanceof Error ? error.message : 'EPS operation failed.' }); }
    finally { setBusy(false); }
  };
  const mutate = async (body: Record<string, unknown>) => {
    await request(body);
    const next: View = await request({ action: 'sync' });
    setView(next);
    if (next.error) setNotice({ error: true, text: next.error });
  };
  const binding = view?.bindings.find(b => b.requirement.id === selected) ?? view?.bindings[0];

  return <div className="w-full h-full overflow-y-auto px-8 py-6 text-zinc-900 dark:text-zinc-100">
    <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
      <div><h2 className="text-lg font-bold">EPS requirements</h2><p className="text-xs text-zinc-500 mt-1">Link released business requirements to this project and keep the owner informed.</p></div>
      <button className={button} onClick={onBack}>Back to requirements</button>
    </div>
    {notice && <p role={notice.error ? 'alert' : 'status'} className={`mb-4 p-3 rounded-lg text-sm ${notice.error ? 'bg-red-500/10 text-red-700 dark:text-red-300' : 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'}`}>{notice.text}</p>}
    {!view ? <p className="text-sm text-zinc-500">Loading EPS settings…</p> : <>
      <form onSubmit={e => { e.preventDefault(); void act(async () => {
        const next = await request({ environment, enabled, ...(token.trim() ? { token: token.trim() } : {}) }, 'PUT');
        setToken(''); setView(next); setAvailable([]);
        setNotice({ text: 'EPS connection settings saved.' });
      }); }} className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 mb-5 space-y-3">
        <h3 className="font-semibold text-sm">Connection</h3>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-xs space-y-1">Environment<select aria-label="EPS environment" className={field} value={environment} disabled={busy || view.bindings.length > 0} onChange={e => setEnvironment(e.target.value as EpsEnvironment)}><option value="staging">Staging</option><option value="production">Production</option></select></label>
          <label className="text-xs space-y-1">Machine token<input aria-label="EPS machine token" type="password" autoComplete="new-password" className={field} value={token} onChange={e => setToken(e.target.value)} placeholder={view.configured ? 'Token configured — enter a replacement if needed' : 'eps_mcp_…'} /></label>
        </div>
        <p className="text-xs text-zinc-500 break-all">{EPS_ENDPOINTS[environment]}</p>
        <label className="flex gap-2 items-center text-xs"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />Synchronize linked requirements every 2 minutes while the app server is running</label>
        <p className="text-xs text-zinc-500">Tokens stay on this computer outside the project. Import only requirements intended for the open project. Your existing specification and plan approvals still apply.</p>
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={button} disabled={busy}>Save connection</button>
          <button type="button" className={button} disabled={busy || !view.configured} onClick={() => void act(async () => { await request({ action: 'test' }); setNotice({ text: 'Connected to EPS. All six required tools are available.' }); })}>Test saved connection</button>
          <button type="button" className={button} disabled={busy || !view.configured || view.authBlocked} onClick={() => void act(async () => {
            const next = await request({ action: 'sync' }); setView(next);
            setNotice({ error: !!next.error, text: next.error || 'EPS synchronization completed.' });
          })}>{busy ? 'Working…' : 'Sync now'}</button>
        </div>
        {view.error && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{view.error}</p>}
        <p className="text-xs text-zinc-500">{view.lastSync ? `Last synchronized: ${new Date(view.lastSync).toLocaleString()}` : 'Not synchronized yet.'}{view.authBlocked ? ' Synchronization is paused until you save a replacement token.' : ''}</p>
      </form>

      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 mb-5">
        <div className="flex flex-wrap justify-between gap-2 items-center"><h3 className="font-semibold text-sm">Released requirements</h3><button className={button} disabled={busy || !view.configured} onClick={() => void act(async () => { const result = await request({ action: 'discover' }); setAvailable(result.requirements); setNotice({ text: `${result.requirements.length} released requirement(s) found.` }); })}>Browse EPS</button></div>
        {available.length > 0 && <ul className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">{available.map(r => <li key={r.id} className="py-3 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0"><p className="text-sm font-semibold break-words">{r.title}</p><p className="text-xs text-zinc-500">{r.stage} · {r.id}</p></div>
          <button className={button} disabled={busy || view.bindings.some(b => b.requirement.id === r.id)} onClick={() => void act(async () => { await request({ action: 'import', id: r.id }); await refresh(); setSelected(r.id); setNotice({ text: 'Imported into this project. Open its requirement list to create a feature.' }); })}>{view.bindings.some(b => b.requirement.id === r.id) ? 'Imported' : 'Import to this project'}</button>
        </li>)}</ul>}
      </div>

      {view.bindings.length > 0 && <div className="space-y-4">
        <label className="block text-xs">Linked requirement<select aria-label="Linked EPS requirement" className={`${field} mt-1`} value={binding?.requirement.id ?? ''} onChange={e => setSelected(e.target.value)}>{view.bindings.map(b => <option key={b.requirement.id} value={b.requirement.id}>{b.requirement.title}</option>)}</select></label>
        {binding && <EpsRequirementDetail key={binding.requirement.id} binding={binding} busy={busy} onOpenList={onOpenList} act={act} mutate={mutate} />}
      </div>}
      {view.outbox.length > 0 && <div className="mt-5 rounded-xl border border-amber-500/40 p-4">
        <h3 className="text-sm font-semibold">Pending reports and messages</h3>
        <p className="text-xs text-zinc-500 mt-1">An uncertain message may already have reached EPS. Check the conversation before discarding it or composing another.</p>
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">{view.outbox.map(item => <li key={item.id} className="py-3 text-xs space-y-2">
          <p>{item.tool} · {item.state} · {item.requirementId}</p>{item.error && <p className="text-red-700 dark:text-red-300">{item.error}</p>}
          {item.tool === 'post_message' && <p className="whitespace-pre-wrap break-words">{String(item.args.body)}</p>}
          <div className="flex gap-2">{item.state === 'failed' && <button className={button} disabled={busy} onClick={() => void act(() => mutate({ action: 'resolve-write', writeId: item.id, resolution: 'retry' }))}>Retry</button>}
            <button className={button} disabled={busy} onClick={() => void act(async () => { await request({ action: 'resolve-write', writeId: item.id, resolution: 'discard' }); await refresh(); })}>Discard queued item</button></div>
        </li>)}</ul>
      </div>}
    </>}
  </div>;
}

type DetailProps = { binding: EpsBinding; busy: boolean; onOpenList: Props['onOpenList']; act: (action: () => Promise<void>) => Promise<void>; mutate: (body: Record<string, unknown>) => Promise<void> };
function EpsRequirementDetail({ binding: b, busy, onOpenList, act, mutate }: DetailProps) {
  const [body, setBody] = useState('');
  const [type, setType] = useState('question');
  const [stage, setStage] = useState('');
  const [velocity, setVelocity] = useState('');
  const [manifest, setManifest] = useState('');
  const [evidence, setEvidence] = useState('');
  const [checks, setChecks] = useState<Record<string, string>>({});
  const [confirmReplace, setConfirmReplace] = useState(false);
  return <>
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs"><span>EPS stage: <strong>{b.requirement.stage}</strong> · {b.requirement.velocity || 'No progress label'}</span><button className={button} onClick={() => onOpenList(b.setId)}>Open requirement list</button></div>
    <p className="text-xs font-mono break-all text-zinc-500">EPS ID: {b.requirement.id} → {b.localId}</p>
    {b.unavailable && <p role="alert" className="p-3 rounded-lg bg-amber-500/10 text-sm">This requirement is no longer released or accessible. Work and reports are paused.</p>}
    {b.waitingForAnswer && <p role="status" className="p-3 rounded-lg bg-amber-500/10 text-sm">Work is paused for an owner decision. Synchronize, then apply the owner’s answer to the local requirement before resuming.</p>}
    {b.conflict && <div role="alert" className="p-3 rounded-lg bg-amber-500/10 text-sm space-y-2"><p>{b.conflict}</p><details><summary>EPS business requirement</summary><p className="whitespace-pre-wrap mt-2">{b.requirement.businessOutcome}</p><ul className="list-disc pl-5">{b.requirement.acceptanceCriteria.map((a, i) => <li key={i}>{a}</li>)}</ul></details>
      {!confirmReplace ? <button className={button} onClick={() => setConfirmReplace(true)}>Replace local content with EPS…</button> : <div className="space-y-2"><p>This replaces local descriptions, criteria, and applied clarifications. Linked specifications will require review again.</p><button className={button} disabled={busy} onClick={() => void act(async () => { await mutate({ action: 'use-eps-content', id: b.requirement.id }); setConfirmReplace(false); })}>Confirm replacement</button><button className={button} onClick={() => setConfirmReplace(false)}>Cancel</button></div>}
    </div>}
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-3">
      <h3 className="font-semibold text-sm">Owner conversation</h3>
      {b.messages.length === 0 && <p className="text-xs text-zinc-500">No messages yet. Sync to retrieve the conversation.</p>}
      <ol className="space-y-3 max-h-96 overflow-y-auto">{b.messages.map(m => <li key={m.id} className="rounded-lg bg-zinc-50 dark:bg-zinc-900 p-3 text-xs"><p className="font-semibold">{m.author === 'business' ? 'Business owner' : 'Development'} · {m.type} <span className="font-normal text-zinc-500">{new Date(m.createdAt).toLocaleString()}</span></p><p className="whitespace-pre-wrap break-words mt-1">{m.body}</p>
        {m.author === 'business' && m.type === 'answer' && <button className={`${button} mt-2`} disabled={busy || b.appliedAnswers.includes(m.id)} onClick={() => void act(() => mutate({ action: 'apply-answer', id: b.requirement.id, messageId: m.id }))}>{b.appliedAnswers.includes(m.id) ? 'Applied to requirement' : 'Apply answer to requirement'}</button>}
      </li>)}</ol>
      <form className="space-y-2" onSubmit={e => { e.preventDefault(); void act(async () => { await mutate({ action: 'message', id: b.requirement.id, type, body }); setBody(''); }); }}>
        <label className="block text-xs">Message type<select className={`${field} mt-1`} value={type} onChange={e => setType(e.target.value)}><option value="question">Question (notifies owner and pauses new work)</option><option value="update">Progress update</option></select></label>
        <label className="block text-xs">Message<textarea className={`${field} mt-1`} rows={3} maxLength={5000} required value={body} onChange={e => setBody(e.target.value)} /></label>
        <button className={button} disabled={busy || b.unavailable || (type === 'question' && b.waitingForAnswer)}>Send to EPS</button>
      </form>
    </div>
    <details className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4">
      <summary className="text-sm font-semibold cursor-pointer">Report delivery or compliance evidence</summary>
      <p className="text-xs text-zinc-500 my-3">Feature progress is reported automatically when synchronization is enabled. Report production only after verifying deployment. Leave unknown compliance checks unchanged.</p>
      <form className="space-y-3" onSubmit={e => { e.preventDefault(); void act(async () => {
        const parsed = manifest.trim() ? JSON.parse(manifest) : undefined;
        const flags = Object.fromEntries(Object.entries(checks).filter(([, value]) => value !== '').map(([key, value]) => [key, value === 'true']));
        if (!stage && !velocity.trim() && !parsed && !Object.keys(flags).length) throw new Error('Choose a stage, progress label, manifest, or compliance check to report.');
        await mutate({ action: 'report', id: b.requirement.id, ...(stage ? { stage } : {}), ...(velocity.trim() ? { velocity: velocity.trim() } : {}), ...(parsed ? { manifest: parsed } : {}), ...(Object.keys(flags).length ? { checks: flags } : {}), evidence });
      }); }}>
        <label className="block text-xs">Stage<select className={`${field} mt-1`} value={stage} onChange={e => setStage(e.target.value)}><option value="">Keep current stage</option>{EPS_STAGES.map(s => <option key={s} value={s}>{s}</option>)}</select></label>
        <label className="block text-xs">Progress label<input className={`${field} mt-1`} maxLength={100} value={velocity} onChange={e => setVelocity(e.target.value)} placeholder="e.g. Ready for owner testing" /></label>
        <label className="block text-xs">PR, release, or test manifest (JSON object)<textarea className={`${field} mt-1 font-mono`} rows={3} value={manifest} onChange={e => setManifest(e.target.value)} placeholder={'{"pr":"https://…","tests":"passing"}'} /></label>
        <div className="grid gap-2 sm:grid-cols-2">{EPS_CHECKS.map(check => <label key={check} className="block text-xs">{check.replaceAll('_', ' ')}<select aria-label={`Compliance ${check}`} className={`${field} mt-1`} value={checks[check] ?? ''} onChange={e => setChecks(current => ({ ...current, [check]: e.target.value }))}><option value="">Unchanged{b.requirement.compliance?.[check] !== undefined ? ` (${b.requirement.compliance[check] ? 'pass' : 'fail'})` : ''}</option><option value="true">Pass — evidence verified</option><option value="false">Fail</option></select></label>)}</div>
        <label className="block text-xs">Evidence (required)<textarea className={`${field} mt-1`} rows={2} required maxLength={5000} value={evidence} onChange={e => setEvidence(e.target.value)} placeholder="Test report, owner acceptance, or verified deployment reference" /></label>
        <button className={button} disabled={busy || b.unavailable || b.waitingForAnswer || !!b.conflict}>Send report to EPS</button>
      </form>
    </details>
  </>;
}
