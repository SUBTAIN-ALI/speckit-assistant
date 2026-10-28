// Extracts blocking findings and a one-line suggested fix from a persona
// review report, for display on the Kanban card's "Fix & Retry" UI.

export type FixSuggestion = {
  failureSummary: string;
  suggestedFix?: string;
};

export function extractFixSuggestion(reportText: string): FixSuggestion | undefined {
  if (!reportText.trim()) return undefined;

  const upper = reportText.toUpperCase();
  if (!upper.includes('VERDICT:') || upper.includes('VERDICT: PASS')) return undefined;

  let blockingSection = '';

  // Strategy 1: look for a "Blocking" section heading
  const blockingMatch = reportText.match(
    /(?:^|\n)#{1,3}\s*\**Blocking\**[^\n]*\n([\s\S]*?)(?=\n#{1,3}\s|\n---|\nVERDICT:|\n\*\*(?:Non-blocking|Nits)\*\*|$)/i
  );
  if (blockingMatch) {
    blockingSection = blockingMatch[1].trim();
  }

  // Strategy 2: bold **Blocking** label (no heading)
  if (!blockingSection) {
    const boldMatch = reportText.match(
      /\*\*Blocking\*\*[^\n]*\n([\s\S]*?)(?=\*\*Non-blocking\*\*|\*\*Nits\*\*|\nVERDICT:|\n---|$)/i
    );
    if (boldMatch) {
      blockingSection = boldMatch[1].trim();
    }
  }

  // Strategy 3: paragraph(s) before VERDICT: FAIL
  if (!blockingSection) {
    const lines = reportText.split(/\r?\n/);
    const verdictIdx = lines.findIndex(l => /VERDICT:\s*\**\s*FAIL/i.test(l));
    if (verdictIdx > 0) {
      const preceding: string[] = [];
      for (let i = verdictIdx - 1; i >= 0 && i >= verdictIdx - 10; i--) {
        const line = lines[i].trim();
        if (!line) { if (preceding.length > 0) break; continue; }
        preceding.unshift(line);
      }
      blockingSection = preceding.join('\n');
    }
  }

  if (!blockingSection) return undefined;

  const failureSummary = blockingSection.slice(0, 500);

  // Extract a one-line suggested fix from the first bullet or sentence
  let suggestedFix: string | undefined;
  const bulletMatch = blockingSection.match(/^[\s]*[-*]\s+(.+)/m);
  if (bulletMatch) {
    suggestedFix = bulletMatch[1].replace(/\*\*/g, '').trim();
  } else {
    const firstSentence = blockingSection.match(/^[^.!?\n]+[.!?]/);
    if (firstSentence) {
      suggestedFix = firstSentence[0].replace(/\*\*/g, '').trim();
    }
  }

  if (suggestedFix && suggestedFix.length > 200) {
    suggestedFix = suggestedFix.slice(0, 197) + '...';
  }

  return { failureSummary, suggestedFix };
}
