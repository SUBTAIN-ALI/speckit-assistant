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

  it('falls back to meaningful lines when no verdict is present', () => {
    const report = `## Summary\nSome review findings that are long enough to be meaningful.`;
    const result = extractFixSuggestion(report);
    expect(result).toBeDefined();
    expect(result!.failureSummary).toContain('review findings');
  });

  it('returns undefined for very short text with no verdict', () => {
    const report = `OK`;
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

  it('extracts from a ## Findings section', () => {
    const report = [
      '## Findings',
      '- The API key is hardcoded in config.ts',
      '- No rate limiting on login endpoint',
      '',
      'VERDICT: FAIL',
    ].join('\n');

    const result = extractFixSuggestion(report);
    expect(result).toBeDefined();
    expect(result!.failureSummary).toContain('API key is hardcoded');
    expect(result!.suggestedFix).toBe('The API key is hardcoded in config.ts');
  });

  it('extracts from numbered list items', () => {
    const report = [
      '## Review',
      '1. Missing error handling in the payment flow',
      '2. No validation on user input',
      '',
      'VERDICT: FAIL',
    ].join('\n');

    const result = extractFixSuggestion(report);
    expect(result).toBeDefined();
    expect(result!.failureSummary).toContain('Missing error handling');
    expect(result!.suggestedFix).toBe('Missing error handling in the payment flow');
  });

  it('falls back to agent output when report is unstructured', () => {
    const rawOutput = [
      '\x1b[32m✓ Build passed\x1b[0m',
      'Error: test suite "auth.test.ts" failed with 3 errors',
      'Expected 200 but received 401 on POST /api/login',
      'Process exited with code 1',
    ].join('\n');

    const result = extractFixSuggestion(rawOutput);
    expect(result).toBeDefined();
    expect(result!.failureSummary).toContain('test suite');
    expect(result!.failureSummary).toContain('Expected 200');
  });
});
