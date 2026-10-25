import { RequirementPriority, RequirementStatus, RequirementType } from '../domain/models/requirements';

export const TYPE_LABELS: Record<RequirementType, string> = {
  functional: 'Functional',
  'non-functional': 'Non-functional',
  constraint: 'Constraint',
  assumption: 'Assumption',
  'open-question': 'Open question',
};

export const PRIORITY_LABELS: Record<RequirementPriority, string> = {
  must: 'Must',
  should: 'Should',
  could: 'Could',
  wont: 'Won’t',
};

export const STATUS_LABELS: Record<RequirementStatus, string> = {
  draft: 'Draft',
  accepted: 'Accepted',
  rejected: 'Rejected',
};

export const PRIORITY_CLS: Record<RequirementPriority, string> = {
  must: 'bg-red-500/10 text-red-700 dark:text-red-400',
  should: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  could: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
  wont: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400',
};

export const STATUS_CLS: Record<RequirementStatus, string> = {
  draft: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400',
  accepted: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  rejected: 'bg-red-500/10 text-red-700 dark:text-red-400 line-through',
};
