// Extracts blocking findings and a one-line suggested fix from a persona
// review report, for display on the Kanban card's "Fix & Retry" UI.

export type FixSuggestion = {
  failureSummary: string;
  suggestedFix?: string;
};

export function extractFixSuggestion(reportText: string): FixSuggestion | undefined {
  if (!reportText.trim()) return undefined;

  const upper = reportText.toUpperCase();
  if (upper.includes('VERDICT: PASS') && !upper.includes('VERDICT: FAIL')) return undefined;

  let blockingSection = '';

  // Strategy 1: look for a "Blocking" section heading
  if (!blockingSection) {
    const blockingMatch = reportText.match(
      /(?:^|\n)#{1,3}\s*\**Blocking\**[^\n]*\n([\s\S]*?)(?=\n#{1,3}\s|\n---|\nVERDICT:|\n\*\*(?:Non-blocking|Nits)\*\*|$)/i
    );
    if (blockingMatch) {
      blockingSection = blockingMatch[1].trim();
    }
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

  // Strategy 3: "Findings" or "Issues" section heading
  if (!blockingSection) {
    const findingsMatch = reportText.match(
      /(?:^|\n)#{1,3}\s*\**(?:Findings|Issues|Problems|Errors|Failures|Critical)\**[^\n]*\n([\s\S]*?)(?=\n#{1,3}\s|\n---|\nVERDICT:|$)/i
    );
    if (findingsMatch) {
      blockingSection = findingsMatch[1].trim();
    }
  }

  // Strategy 4: paragraph(s) before VERDICT: FAIL
  if (!blockingSection && upper.includes('VERDICT:')) {
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

  // Strategy 5: numbered list items (e.g. "1. Missing error handling in...")
  if (!blockingSection) {
    const numbered = [...reportText.matchAll(/^\s*\d+[.)]\s+(.+)/gm)];
    if (numbered.length > 0) {
      blockingSection = numbered.map(m => m[0].trim()).join('\n');
    }
  }

  // Strategy 6 (fallback): last meaningful lines from the text, stripping
  // ANSI codes. Used when the report is unstructured or when only raw agent
  // output is available.
  if (!blockingSection) {
    const cleaned = reportText.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '');
    const lines = cleaned.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const meaningful = lines.filter(l =>
      l.length > 15 &&
      !/^(✓|Process exited|▶|→|Reply to continue|===)/i.test(l)
    );
    blockingSection = meaningful.slice(-5).join('\n');
  }

  if (!blockingSection) return undefined;

  const failureSummary = blockingSection.slice(0, 500);

  // Extract a one-line suggested fix from the first bullet, numbered item, or sentence
  let suggestedFix: string | undefined;
  const bulletMatch = blockingSection.match(/^[\s]*[-*]\s+(.+)/m);
  if (bulletMatch) {
    suggestedFix = bulletMatch[1].replace(/\*\*/g, '').trim();
  }
  if (!suggestedFix) {
    const numberedMatch = blockingSection.match(/^\s*\d+[.)]\s+(.+)/m);
    if (numberedMatch) {
      suggestedFix = numberedMatch[1].replace(/\*\*/g, '').trim();
    }
  }
  if (!suggestedFix) {
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
