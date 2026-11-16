export type EvidenceType =
  | 'code-fact'
  | 'spec-intent'
  | 'review-outcome'
  | 'general-knowledge'
  | 'uncertain';

export type EvidenceSpan = {
  type: EvidenceType;
  text: string;
  startIndex: number;
  endIndex: number;
};

const EVIDENCE_MARKERS: Record<string, EvidenceType> = {
  '[Code Fact]': 'code-fact',
  '[Spec Intent]': 'spec-intent',
  '[Review Outcome]': 'review-outcome',
  '[General Knowledge]': 'general-knowledge',
  '[Uncertain]': 'uncertain',
};

const MARKER_REGEX = /\[(Code Fact|Spec Intent|Review Outcome|General Knowledge|Uncertain)\]/g;

export function parseEvidence(text: string): EvidenceSpan[] {
  const spans: EvidenceSpan[] = [];
  let lastIndex = 0;
  let lastType: EvidenceType | null = null;

  let match: RegExpExecArray | null;
  while ((match = MARKER_REGEX.exec(text)) !== null) {
    if (lastIndex < match.index && lastType === null) {
      // text before the first marker — no evidence type
    }
    if (lastType !== null && lastIndex < match.index) {
      const segment = text.slice(lastIndex, match.index).trim();
      if (segment) {
        spans.push({
          type: lastType,
          text: segment,
          startIndex: lastIndex,
          endIndex: match.index,
        });
      }
    }
    const markerText = match[0] as keyof typeof EVIDENCE_MARKERS;
    lastType = EVIDENCE_MARKERS[markerText];
    lastIndex = match.index + match[0].length;
  }

  if (lastType !== null && lastIndex < text.length) {
    const remaining = text.slice(lastIndex).trim();
    if (remaining) {
      spans.push({
        type: lastType,
        text: remaining,
        startIndex: lastIndex,
        endIndex: text.length,
      });
    }
  }

  return spans;
}

export function hasEvidence(text: string): boolean {
  return MARKER_REGEX.test(text);
}

export function getEvidenceLabel(type: EvidenceType): string {
  switch (type) {
    case 'code-fact': return 'Code Fact';
    case 'spec-intent': return 'Spec Intent';
    case 'review-outcome': return 'Review Outcome';
    case 'general-knowledge': return 'General Knowledge';
    case 'uncertain': return 'Uncertain';
  }
}

export function getEvidenceColor(type: EvidenceType): string {
  switch (type) {
    case 'code-fact': return 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30';
    case 'spec-intent': return 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/30';
    case 'review-outcome': return 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/30';
    case 'general-knowledge': return 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30';
    case 'uncertain': return 'text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800';
  }
}
