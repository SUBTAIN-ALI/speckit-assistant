import { describe, it, expect } from 'vitest';
import { extractFixSuggestion } from './fixExtraction';

describe('extractFixSuggestion', () => {
  it('returns undefined for empty text', () => {
    expect(extractFixSuggestion('')).toBeUndefined();
    expect(extractFixSuggestion('  ')).toBeUndefined();
  });

  it('returns undefined for a PASS report', () => {
    const report = `## Summary\nEverything looks good.\n\nVERDICT: PASS`;
    expect(extractFixSuggestion(report)).toBeUndefined();
  });

  it('returns undefined when no verdict is present', () => {
    const report = `## Summary\nSome review findings.`;
    expect(extractFixSuggestion(report)).toBeUndefined();
  });

  it('extracts from a ## Blocking section', () => {
    const report = [
      '## Summary',
      'Found issues.',
      '',
      '## Blocking',
      '- Missing CSRF token on the upload endpoint',
      '- No input sanitization on user fields',
      '',
      '## Non-blocking',
      '- Consider renaming the variable',
      '',
      'VERDICT: FAIL',
    ].join('\n');

    const result = extractFixSuggestion(report);
    expect(result).toBeDefined();
    expect(result!.failureSummary).toContain('Missing CSRF token');
    expect(result!.failureSummary).toContain('No input sanitization');
    expect(result!.suggestedFix).toBe('Missing CSRF token on the upload endpoint');
  });

  it('extracts from a **Blocking** bold label', () => {
    const report = [
      '## Summary',
      'Issues found.',
      '',
      '**Blocking**',
      '- SQL injection in query builder at db.ts:42',
      '',
      '**Non-blocking**',
      '- Minor style issues',
      '',
      'VERDICT: FAIL',
    ].join('\n');

    const result = extractFixSuggestion(report);
    expect(result).toBeDefined();
    expect(result!.failureSummary).toContain('SQL injection');
    expect(result!.suggestedFix).toBe('SQL injection in query builder at db.ts:42');
  });

  it('falls back to the paragraph before VERDICT: FAIL', () => {
    const report = [
      '## Summary',
      'The upload handler is missing authentication.',
      '',
      'The endpoint at api/upload allows unauthenticated access.',
      '',
      'VERDICT: FAIL',
    ].join('\n');

    const result = extractFixSuggestion(report);
    expect(result).toBeDefined();
    expect(result!.failureSummary).toContain('unauthenticated access');
  });

  it('truncates suggestedFix to 200 chars', () => {
    const longLine = 'A'.repeat(250);
    const report = [
      '## Blocking',
      `- ${longLine}`,
      '',
      'VERDICT: FAIL',
    ].join('\n');

    const result = extractFixSuggestion(report);
    expect(result).toBeDefined();
    expect(result!.suggestedFix!.length).toBeLessThanOrEqual(200);
    expect(result!.suggestedFix!.endsWith('...')).toBe(true);
  });

  it('extracts suggestedFix from first sentence when no bullets', () => {
    const report = [
      '## Blocking',
      'The auth middleware is completely missing. Users can access any endpoint without login.',
      '',
      'VERDICT: FAIL',
    ].join('\n');

    const result = extractFixSuggestion(report);
    expect(result).toBeDefined();
    expect(result!.suggestedFix).toBe('The auth middleware is completely missing.');
  });
});
