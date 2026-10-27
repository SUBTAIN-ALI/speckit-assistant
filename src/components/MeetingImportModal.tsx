'use client';

import React, { useEffect, useRef, useState } from 'react';
import { X, Video, Upload, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { ImportProgress, ImportStatus } from '../domain/models/meeting';
import { RequirementsDoc } from '../domain/models/requirements';
import { AUDIO_EXTENSIONS, DOCUMENT_EXTENSIONS, MAX_DOCUMENT_BYTES, documentTooLarge, isAudioFilename, isDocumentFilename } from '../domain/services/transcript';

type Props = {
  isOpen: boolean;
  zoomConnected: boolean;
  llmLabel: string | null; // e.g. "OpenAI · gpt-4.1-mini"; null when not ready
  // Why importing can't start yet, and where to fix it (shown when llmLabel is null).
  blocker?: { message: string; action?: { label: string; onClick: () => void; busy?: boolean } } | null;
  onClose: () => void;
  onImported: (setId: string, doc: RequirementsDoc) => void;
  onOpenSettings: () => void;
};

type Outcome = { status: ImportStatus; message: string; setId?: string; doc?: RequirementsDoc; added?: number; cost?: { costUSD?: number; totalTokens?: number } };

// Each import creates a new requirement list (one per meeting).
export const MeetingImportModal: React.FC<Props> = ({ isOpen, zoomConnected, llmLabel, blocker, onClose, onImported, onOpenSettings }) => {
  const [tab, setTab] = useState<'zoom' | 'file'>(zoomConnected ? 'zoom' : 'file');
  const [link, setLink] = useState('');
  const [title, setTitle] = useState('');
  // A transcript is read as text; a recording or document is sent as-is and
  // transcribed / converted on the server.
  const [file, setFile] = useState<{ name: string; text?: string; upload?: { kind: 'recording' | 'document'; file: File } } | null>(null);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<ImportProgress[]>([]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Default to the Zoom tab whenever the dialog opens with Zoom connected.
  useEffect(() => {
    if (isOpen) setTab(zoomConnected ? 'zoom' : 'file');
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isOpen) return null;

  const reset = () => {
    setLog([]);
    setOutcome(null);
  };

  const close = () => {
    abortRef.current?.abort();
    setRunning(false);
    reset();
    setLink('');
    setTitle('');
    setFile(null);
    onClose();
  };

  const pickFile = async (f: File | undefined) => {
    reset();
    if (!f) return setFile(null);
    if (isAudioFilename(f.name)) setFile({ name: f.name, upload: { kind: 'recording', file: f } });
    else if (isDocumentFilename(f.name)) {
      if (f.size > MAX_DOCUMENT_BYTES) {
        setFile(null);
        setOutcome({ status: 'invalid_input', message: documentTooLarge(f.name, f.size) });
        return;
      }
      setFile({ name: f.name, upload: { kind: 'document', file: f } });
    }
    else setFile({ name: f.name, text: await f.text() });
  };

  const start = async () => {
    reset();
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      let res: Response;
      if (tab === 'file' && file?.upload) {
        const form = new FormData();
        form.append('file', file.upload.file);
        if (title) form.append('title', title);
        res = await fetch('/api/meeting/import', { method: 'POST', body: form, signal: controller.signal });
      } else {
        const body = tab === 'zoom'
          ? { link, title: title || undefined }
          : { transcript: file?.text ?? '', filename: file?.name, title: title || undefined };
        res = await fetch('/api/meeting/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      }
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        setOutcome({ status: 'invalid_input', message: data.error || `Request failed (${res.status})` });
        return;
      }
      // Parse the SSE stream: progress events, then done/error.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';
        for (const evt of events) {
          const name = /^event: (.*)$/m.exec(evt)?.[1];
          const dataLine = /^data: (.*)$/m.exec(evt)?.[1];
          if (!name || !dataLine) continue;
          const data = JSON.parse(dataLine);
          if (name === 'progress') setLog(l => [...l, data as ImportProgress]);
          else if (name === 'done') {
            const o = data as Outcome;
            setOutcome(o);
            if (o.status === 'ok' && o.doc && o.setId) onImported(o.setId, o.doc);
          } else if (name === 'error') setOutcome({ status: 'llm_error', message: data.message });
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') setOutcome({ status: 'llm_error', message: err.message });
    } finally {
      setRunning(false);
    }
  };

  const canStart = !running && !!llmLabel && (tab === 'zoom' ? zoomConnected && link.trim().length > 0 : !!file);
  const tabCls = (active: boolean) => `flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition ${active ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 shadow-sm' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'}`;
  const inputCls = 'w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/40';

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6" role="dialog" aria-modal="true" aria-labelledby="import-title" onKeyDown={e => { if (e.key === 'Escape' && !running) close(); }}>
      <div className="w-full max-w-lg rounded-xl bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 dark:border-zinc-800">
          <div>
            <h3 id="import-title" className="text-sm font-bold text-zinc-900 dark:text-white">Import requirements</h3>
            <p className="text-[11px] text-zinc-500 mt-0.5">Creates a new requirement list{llmLabel ? ` · using ${llmLabel}` : ''}</p>
          </div>
          <button onClick={close} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-900" aria-label="Close"><X size={15} /></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {!llmLabel && (
            <p className="text-[11px] text-amber-700 dark:text-amber-400 bg-amber-500/10 rounded-lg p-3">
              {blocker
                ? <>{blocker.message}{blocker.action && <> <button onClick={blocker.action.onClick} disabled={blocker.action.busy} className="underline font-semibold disabled:opacity-60 disabled:no-underline">{blocker.action.label}</button></>}</>
                : <>Add an AI provider key first. <button onClick={onOpenSettings} className="underline font-semibold">Open settings</button></>}
            </p>
          )}

          <div className="inline-flex bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-0.5">
            <button className={tabCls(tab === 'zoom')} onClick={() => { setTab('zoom'); reset(); }}><Video size={13} /> Zoom link</button>
            <button className={tabCls(tab === 'file')} onClick={() => { setTab('file'); reset(); }}><Upload size={13} /> File</button>
          </div>

          {tab === 'zoom' ? (
            zoomConnected ? (
              <div>
                <label htmlFor="zoom-link" className="block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 mb-1">Meeting link or ID</label>
                <input
                  id="zoom-link"
                  autoFocus
                  value={link}
                  onChange={e => { setLink(e.target.value); reset(); }}
                  onKeyDown={e => { if (e.key === 'Enter' && canStart) start(); }}
                  placeholder="https://us02web.zoom.us/j/85012345678"
                  className={`${inputCls} font-mono`}
                />
                <p className="text-[10px] text-zinc-500 mt-1">A past meeting in your Zoom account with a cloud recording transcript or AI Companion summary. Free plans record to your computer only — upload that recording under File instead.</p>
              </div>
            ) : (
              <p className="text-[11px] text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-900/60 rounded-lg p-3">
                Zoom isn’t connected. <button onClick={onOpenSettings} className="underline font-semibold">Connect Zoom in settings</button>, or upload a transcript, recording or document under File instead.
              </p>
            )
          ) : (
            <label className="flex flex-col items-center justify-center gap-1.5 px-4 py-6 rounded-lg border-2 border-dashed border-zinc-200 dark:border-zinc-800 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900/60 text-center">
              <Upload size={18} className="text-zinc-400" />
              <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                {file ? `${file.name}${file.upload ? ` · ${(file.upload.file.size / 1024 / 1024).toFixed(1)} MB` : ''}` : 'Choose a transcript, recording or document'}
              </span>
              <span className="text-[10px] text-zinc-500">
                {file?.upload?.kind === 'recording'
                  ? 'Transcribed with your OpenAI key first (about $0.006 per minute), then requirements are extracted.'
                  : file?.upload?.kind === 'document'
                    ? 'Converted to text on your machine, then requirements are extracted from what the document states.'
                    : 'Transcript: .vtt, .txt or .md · Recording: .m4a, .mp4, .mp3 or .wav · Document (up to 5 MB): PDF, Word, PowerPoint, Excel, OpenDocument, RTF'}
              </span>
              <input type="file" accept={[
                '.vtt,.txt,.md,text/vtt,text/plain',
                ...AUDIO_EXTENSIONS.map(e => `.${e}`), 'audio/*,video/mp4',
                ...DOCUMENT_EXTENSIONS.map(e => `.${e}`),
              ].join(',')} className="sr-only" onChange={e => pickFile(e.target.files?.[0])} />
            </label>
          )}

          <div>
            <label htmlFor="import-title-input" className="block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 mb-1">List name <span className="font-normal text-zinc-400">(optional — defaults to the meeting topic or file name)</span></label>
            <input id="import-title-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Checkout redesign sync" className={inputCls} />
          </div>

          {log.length > 0 && (
            <ol className="space-y-1" aria-live="polite">
              {log.map((p, i) => (
                <li key={i} className="text-[11px] text-zinc-600 dark:text-zinc-400 flex items-center gap-1.5">
                  {running && i === log.length - 1 ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} className="text-zinc-400" />}
                  {p.message}
                </li>
              ))}
            </ol>
          )}

          {outcome && (
            <p role={outcome.status === 'ok' ? 'status' : 'alert'} className={`text-[11px] rounded-lg p-3 flex gap-1.5 ${outcome.status === 'ok' ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300' : 'bg-red-500/10 text-red-800 dark:text-red-300'}`}>
              {outcome.status === 'ok' ? <CheckCircle2 size={13} className="shrink-0 mt-px" /> : <AlertTriangle size={13} className="shrink-0 mt-px" />}
              <span>
                {outcome.message}
                {outcome.status === 'ok' && outcome.cost?.costUSD !== undefined && (
                  <span className="block mt-1 opacity-75">≈ ${outcome.cost.costUSD.toFixed(3)} · {outcome.cost.totalTokens?.toLocaleString()} tokens (estimate)</span>
                )}
                {(outcome.status === 'not_configured' || outcome.status === 'auth_required') && (
                  <button onClick={onOpenSettings} className="block mt-1 underline font-semibold">Open settings</button>
                )}
              </span>
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-zinc-200 dark:border-zinc-800">
          <button onClick={close} className="px-3 py-2 rounded-lg text-xs font-semibold border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900">
            {outcome?.status === 'ok' ? 'Done' : running ? 'Cancel' : 'Close'}
          </button>
          {outcome?.status !== 'ok' && (
            <button onClick={start} disabled={!canStart} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-black dark:bg-white text-white dark:text-black hover:opacity-90 disabled:opacity-40">
              {running && <Loader2 size={13} className="animate-spin" />} {running ? 'Importing…' : 'Import'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default MeetingImportModal;
