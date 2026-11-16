'use client';

import React, { useCallback, useEffect } from 'react';
import { X, AlertTriangle, Check, XIcon, GitMerge } from 'lucide-react';
import type { KnowledgeChange } from '../domain/models';

type Props = {
  change: KnowledgeChange;
  open: boolean;
  onApprove: () => void;
  onReject: () => void;
  onMerge?: () => void;
};

function diffLines(before: string, after: string): { type: 'same' | 'added' | 'removed'; text: string }[] {
  const oldLines = before.split('\n');
  const newLines = after.split('\n');
  const result: { type: 'same' | 'added' | 'removed'; text: string }[] = [];
  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);

  for (const line of oldLines) {
    if (!newSet.has(line)) {
      result.push({ type: 'removed', text: line });
    }
  }
  for (const line of newLines) {
    if (!oldSet.has(line)) {
      result.push({ type: 'added', text: line });
    } else {
      result.push({ type: 'same', text: line });
    }
  }
  return result;
}

export const KnowledgeApprovalModal: React.FC<Props> = ({ change, open, onApprove, onReject, onMerge }) => {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onReject();
  }, [onReject]);

  useEffect(() => {
    if (open) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  const isNew = change.previousContent === null;
  const isUpdate = !isNew;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onReject(); }}
    >
      <div className="w-[90vw] max-w-[700px] max-h-[85vh] bg-white dark:bg-zinc-950 rounded-xl shadow-2xl border border-zinc-200 dark:border-zinc-800 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {isNew ? 'Save New Knowledge' : 'Update Knowledge'}
            </h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              Topic: <span className="font-medium">{change.title}</span>
              <span className="text-zinc-400 ml-1">({change.slug})</span>
            </p>
          </div>
          <button onClick={onReject} className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition">
            <X size={16} />
          </button>
        </div>

        {/* Conflict Warning */}
        {change.isConflict && (
          <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800">
            <AlertTriangle size={14} className="text-amber-600 dark:text-amber-400 shrink-0" />
            <span className="text-xs text-amber-700 dark:text-amber-300">
              This update removes existing content. Review carefully before approving.
            </span>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
          {isNew ? (
            <div>
              <p className="text-xs text-zinc-500 mb-2">Proposed content:</p>
              <div className="rounded-md bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 p-3 text-sm text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap font-mono">
                {change.proposedContent}
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-xs text-zinc-500 mb-2">Changes:</p>
              <div className="rounded-md border border-zinc-200 dark:border-zinc-800 overflow-hidden font-mono text-xs">
                {diffLines(change.previousContent!, change.proposedContent).map((line, i) => (
                  <div
                    key={i}
                    className={`px-3 py-0.5 ${
                      line.type === 'removed'
                        ? 'bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-300'
                        : line.type === 'added'
                        ? 'bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-300'
                        : 'text-zinc-600 dark:text-zinc-400'
                    }`}
                  >
                    <span className="select-none mr-2 text-zinc-400">
                      {line.type === 'removed' ? '-' : line.type === 'added' ? '+' : ' '}
                    </span>
                    {line.text || ' '}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="shrink-0 flex items-center justify-end gap-2 px-4 py-3 border-t border-zinc-200 dark:border-zinc-800">
          {change.isConflict && onMerge && (
            <button
              onClick={onMerge}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100 dark:hover:bg-amber-900/40 border border-amber-200 dark:border-amber-700 transition"
            >
              <GitMerge size={14} /> Merge
            </button>
          )}
          <button
            onClick={onReject}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
          >
            <XIcon size={14} /> Reject
          </button>
          <button
            onClick={onApprove}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-white bg-zinc-900 dark:bg-zinc-100 dark:text-black hover:bg-zinc-700 dark:hover:bg-zinc-300 transition"
          >
            <Check size={14} /> Approve
          </button>
        </div>
      </div>
    </div>
  );
};

export default KnowledgeApprovalModal;
