'use client';

import React from 'react';
import { Info, Lightbulb, AlertTriangle, AlertOctagon, Flame, type LucideProps } from 'lucide-react';

type AlertType = 'NOTE' | 'TIP' | 'IMPORTANT' | 'WARNING' | 'CAUTION';

const ALERT_CONFIG: Record<AlertType, { icon: React.FC<LucideProps>; color: string; bg: string }> = {
  NOTE: { icon: Info, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800' },
  TIP: { icon: Lightbulb, color: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-950/40 border-green-200 dark:border-green-800' },
  IMPORTANT: { icon: AlertTriangle, color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-950/40 border-purple-200 dark:border-purple-800' },
  WARNING: { icon: AlertOctagon, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800' },
  CAUTION: { icon: Flame, color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800' },
};

export function detectAlert(children: React.ReactNode): { type: AlertType; rest: React.ReactNode } | null {
  const childArray = React.Children.toArray(children);
  if (childArray.length === 0) return null;

  const first = childArray[0];
  if (!React.isValidElement(first)) return null;

  const inner = (first.props as Record<string, unknown>)?.children;
  const text = typeof inner === 'string' ? inner : Array.isArray(inner) ? inner.find((c: unknown) => typeof c === 'string') : null;
  if (typeof text !== 'string') return null;

  const match = text.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/);
  if (!match) return null;

  const type = match[1] as AlertType;
  const remaining = text.slice(match[0].length);

  const updatedFirst = React.cloneElement(first as React.ReactElement<{ children?: React.ReactNode }>, {
    children: remaining || undefined,
  });

  return { type, rest: [remaining ? updatedFirst : null, ...childArray.slice(1)].filter(Boolean) };
}

export const GithubAlert: React.FC<{ type: AlertType; children: React.ReactNode }> = ({ type, children }) => {
  const config = ALERT_CONFIG[type];
  const Icon = config.icon;

  return (
    <div className={`flex gap-2 rounded-md border px-3 py-2 my-2 not-prose ${config.bg}`}>
      <Icon size={16} className={`shrink-0 mt-0.5 ${config.color}`} />
      <div className="text-sm flex-1 min-w-0">{children}</div>
    </div>
  );
};
