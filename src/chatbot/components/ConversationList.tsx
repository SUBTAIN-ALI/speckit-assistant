'use client';

import React, { useCallback, useState } from 'react';
import { Plus, Trash2, MessageSquare } from 'lucide-react';
import type { ConversationSummary } from '../domain/models';

type Props = {
  conversations: ConversationSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 172800000) return 'Yesterday';
  return `${Math.floor(diff / 86400000)}d ago`;
}

export const ConversationList: React.FC<Props> = ({ conversations, activeId, onSelect, onNew, onDelete }) => {
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const handleDelete = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirmDelete === id) {
      onDelete(id);
      setConfirmDelete(null);
    } else {
      setConfirmDelete(id);
      setTimeout(() => setConfirmDelete(null), 3000);
    }
  }, [confirmDelete, onDelete]);

  return (
    <div className="flex flex-col h-full bg-zinc-50 dark:bg-zinc-950 border-r border-zinc-200 dark:border-zinc-800">
      <div className="shrink-0 flex items-center justify-between px-3 py-2.5 border-b border-zinc-200 dark:border-zinc-800">
        <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">History</span>
        <button
          onClick={onNew}
          className="p-1 rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition"
          title="New conversation"
        >
          <Plus size={14} />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {conversations.length === 0 && (
          <div className="px-3 py-6 text-xs text-zinc-400 dark:text-zinc-600 text-center">
            No conversations yet
          </div>
        )}
        {conversations.map(c => (
          <div
            key={c.id}
            onClick={() => onSelect(c.id)}
            className={`group flex items-start gap-2 px-3 py-2.5 cursor-pointer transition border-b border-zinc-100 dark:border-zinc-900 ${
              c.id === activeId
                ? 'bg-white dark:bg-zinc-900'
                : 'hover:bg-white dark:hover:bg-zinc-900/50'
            }`}
          >
            <MessageSquare size={14} className="shrink-0 mt-0.5 text-zinc-400" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300 truncate">
                {c.title || 'Untitled'}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] text-zinc-400">{relativeTime(c.updatedAt)}</span>
                <span className="text-[10px] text-zinc-400">{c.messageCount} msg{c.messageCount !== 1 ? 's' : ''}</span>
              </div>
            </div>
            <button
              onClick={(e) => handleDelete(e, c.id)}
              className={`shrink-0 p-0.5 rounded transition ${
                confirmDelete === c.id
                  ? 'text-red-500 bg-red-50 dark:bg-red-950/30'
                  : 'text-zinc-300 dark:text-zinc-700 opacity-0 group-hover:opacity-100 hover:text-red-500'
              }`}
              title={confirmDelete === c.id ? 'Click again to confirm' : 'Delete'}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ConversationList;
