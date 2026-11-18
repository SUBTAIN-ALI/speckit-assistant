'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { X, GitCommit, Upload, Loader2, AlertCircle, CheckCircle2, FileCode, FilePlus, FileX } from 'lucide-react';

type ChangedFile = {
  path: string;
  additions: number;
  deletions: number;
  type: string;
};

type GitCommitModalProps = {
  isOpen: boolean;
  onClose: () => void;
  featureName?: string;
};

const input =
  'w-full px-3 py-2 text-xs bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-md outline-none text-zinc-900 dark:text-white focus:border-zinc-400 dark:focus:border-zinc-600';

export const GitCommitModal: React.FC<GitCommitModalProps> = ({ isOpen, onClose, featureName }) => {
  const [files, setFiles] = useState<ChangedFile[]>([]);
  const [branch, setBranch] = useState('');
  const [commitMsg, setCommitMsg] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [pushed, setPushed] = useState(false);
  const [commitHash, setCommitHash] = useState('');
  const [error, setError] = useState('');
  const [pushError, setPushError] = useState('');

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/git?action=status');
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        return;
      }
      setFiles(data.files || []);
      setBranch(data.branch || 'HEAD');
      const all = new Set<string>((data.files || []).map((f: ChangedFile) => f.path));
      setSelectedFiles(all);

      if (!commitMsg && featureName) {
        setCommitMsg(`feat: implement ${featureName}`);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch git status');
    } finally {
      setLoading(false);
    }
  }, [featureName, commitMsg]);

  useEffect(() => {
    if (isOpen) {
      setCommitted(false);
      setPushed(false);
      setCommitHash('');
      setError('');
      setPushError('');
      setCommitMsg('');
      fetchStatus();
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isOpen) return null;

  const toggleFile = (path: string) => {
    setSelectedFiles(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedFiles.size === files.length) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(files.map(f => f.path)));
    }
  };

  const handleCommit = async () => {
    if (!commitMsg.trim()) {
      setError('Please enter a commit message.');
      return;
    }
    if (selectedFiles.size === 0) {
      setError('Please select at least one file.');
      return;
    }
    setCommitting(true);
    setError('');
    try {
      const res = await fetch('/api/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'commit',
          message: commitMsg.trim(),
          files: Array.from(selectedFiles),
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || 'Commit failed');
        return;
      }
      setCommitted(true);
      setCommitHash(data.hash || '');
    } catch (err: any) {
      setError(err.message || 'Commit failed');
    } finally {
      setCommitting(false);
    }
  };

  const handlePush = async () => {
    setPushing(true);
    setPushError('');
    try {
      const res = await fetch('/api/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'push' }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setPushError(data.error || 'Push failed');
        return;
      }
      setPushed(true);
    } catch (err: any) {
      setPushError(err.message || 'Push failed');
    } finally {
      setPushing(false);
    }
  };

  const fileIcon = (f: ChangedFile) => {
    if (f.deletions === 0 && f.additions > 0) return <FilePlus size={12} className="text-green-500" />;
    if (f.additions === 0 && f.deletions > 0) return <FileX size={12} className="text-red-500" />;
    return <FileCode size={12} className="text-blue-500" />;
  };

  return (
    <div className="fixed inset-0 bg-black/50 dark:bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 w-full max-w-xl rounded-xl flex flex-col overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-200 max-h-[85vh]">
        {/* Header */}
        <header className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-center bg-zinc-50 dark:bg-zinc-900/50 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-orange-500/10 text-orange-600 dark:text-orange-400 rounded-lg">
              <GitCommit size={16} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-zinc-900 dark:text-white tracking-tight">
                Commit & Push
              </h2>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                {branch && <>Branch: <span className="font-mono font-semibold">{branch}</span></>}
                {featureName && <> &middot; {featureName}</>}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg text-zinc-500 dark:text-zinc-400 transition">
            <X size={16} />
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-zinc-400">
              <Loader2 size={20} className="animate-spin mr-2" /> Loading changes...
            </div>
          ) : (
            <>
              {/* Error */}
              {error && (
                <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-xs">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  <span className="break-all">{error}</span>
                </div>
              )}

              {/* Success states */}
              {committed && (
                <div className="flex items-start gap-2 p-3 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg text-green-700 dark:text-green-400 text-xs">
                  <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
                  <span>Committed successfully!{commitHash && <> (<span className="font-mono">{commitHash}</span>)</>}</span>
                </div>
              )}
              {pushed && (
                <div className="flex items-start gap-2 p-3 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg text-green-700 dark:text-green-400 text-xs">
                  <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
                  <span>Pushed to <span className="font-mono font-semibold">{branch}</span> successfully!</span>
                </div>
              )}
              {pushError && (
                <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-xs">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  <span className="break-all">{pushError}</span>
                </div>
              )}

              {/* Commit message */}
              {!committed && (
                <>
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">Commit Message</label>
                    <textarea
                      className={`${input} resize-none h-20 font-mono`}
                      value={commitMsg}
                      onChange={e => { setCommitMsg(e.target.value); setError(''); }}
                      placeholder="feat: describe your changes..."
                    />
                  </div>

                  {/* File list */}
                  <div>
                    <div className="flex justify-between items-center mb-1.5">
                      <label className="block text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                        Changed Files ({selectedFiles.size}/{files.length})
                      </label>
                      <button onClick={toggleAll} className="text-[10px] text-blue-500 hover:text-blue-600 font-semibold">
                        {selectedFiles.size === files.length ? 'Deselect All' : 'Select All'}
                      </button>
                    </div>
                    {files.length === 0 ? (
                      <p className="text-xs text-zinc-400 italic p-3 text-center">No changes detected.</p>
                    ) : (
                      <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                        {files.map(f => (
                          <label
                            key={f.path}
                            className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 cursor-pointer border-b border-zinc-100 dark:border-zinc-900 last:border-b-0"
                          >
                            <input
                              type="checkbox"
                              checked={selectedFiles.has(f.path)}
                              onChange={() => toggleFile(f.path)}
                              className="w-3.5 h-3.5 rounded border-zinc-300 dark:border-zinc-700 text-blue-500 focus:ring-0"
                            />
                            {fileIcon(f)}
                            <span className="text-[11px] font-mono text-zinc-700 dark:text-zinc-300 truncate flex-1">{f.path}</span>
                            <span className="text-[10px] shrink-0">
                              {f.additions > 0 && <span className="text-green-500 mr-1">+{f.additions}</span>}
                              {f.deletions > 0 && <span className="text-red-500">-{f.deletions}</span>}
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <footer className="px-5 py-3.5 border-t border-zinc-200 dark:border-zinc-800 flex justify-end gap-2.5 bg-zinc-50 dark:bg-zinc-900/30 shrink-0">
          <button
            onClick={onClose}
            className="px-3.5 py-2 bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 font-semibold text-xs rounded-lg transition"
          >
            {pushed ? 'Done' : 'Cancel'}
          </button>

          {!committed && (
            <button
              onClick={handleCommit}
              disabled={committing || files.length === 0 || loading}
              className="px-3.5 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-semibold text-xs rounded-lg transition flex items-center gap-1.5"
            >
              {committing ? <Loader2 size={12} className="animate-spin" /> : <GitCommit size={12} />}
              Commit
            </button>
          )}

          {committed && !pushed && (
            <button
              onClick={handlePush}
              disabled={pushing}
              className="px-3.5 py-2 bg-green-500 hover:bg-green-600 disabled:opacity-50 text-white font-semibold text-xs rounded-lg transition flex items-center gap-1.5"
            >
              {pushing ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
              Push to GitHub
            </button>
          )}
        </footer>
      </div>
    </div>
  );
};

export default GitCommitModal;
