'use client';

import React, { useState } from 'react';
import { FileText, GitBranch, BookOpen, MessageSquare, Search, ChevronDown, ChevronRight } from 'lucide-react';
import type { CitationSource } from '../domain/models';

type Props = {
  citations: CitationSource[];
};

function iconForType(type: CitationSource['type']) {
  switch (type) {
    case 'file': return <FileText size={12} />;
    case 'git': return <GitBranch size={12} />;
    case 'spec':
    case 'requirement': return <BookOpen size={12} />;
    case 'knowledge': return <Search size={12} />;
    case 'meeting':
    case 'review': return <MessageSquare size={12} />;
  }
}

function labelForType(type: CitationSource['type']): string {
  switch (type) {
    case 'file': return 'File';
    case 'git': return 'Git';
    case 'spec': return 'Spec';
    case 'requirement': return 'Requirement';
    case 'knowledge': return 'Knowledge';
    case 'meeting': return 'Meeting';
    case 'review': return 'Review';
  }
}

export const CitationView: React.FC<Props> = ({ citations }) => {
  const [expanded, setExpanded] = useState(false);

  if (citations.length === 0) return null;

  return (
    <div className="mt-2 border-t border-zinc-100 dark:border-zinc-800 pt-1.5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {citations.length} source{citations.length !== 1 ? 's' : ''}
      </button>
      {expanded && (
        <div className="mt-1.5 space-y-1">
          {citations.map((c, i) => (
            <div key={i} className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              <span className="text-zinc-400">{iconForType(c.type)}</span>
              <span className="px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 font-medium uppercase" style={{ fontSize: '9px' }}>
                {labelForType(c.type)}
              </span>
              <span className="truncate font-mono">
                {c.path}
                {c.lineStart != null && `:${c.lineStart}${c.lineEnd ? `-${c.lineEnd}` : ''}`}
              </span>
              {c.label && <span className="text-zinc-400 italic truncate">{c.label}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CitationView;
