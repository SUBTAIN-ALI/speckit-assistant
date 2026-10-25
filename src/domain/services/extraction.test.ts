import { describe, it, expect } from 'vitest';
import { validateExtraction, mergeExtractions, buildRequirementsDoc, EXTRACTION_SCHEMA, Extraction } from './extraction';
import { buildExtractionUserMessage, EXTRACTION_SYSTEM_PROMPT } from './extractionPrompt';

const item = (title: string, extra: Record<string, unknown> = {}) => ({
  title, type: 'functional', priority: 'must', description: 'd', acceptanceCriteria: ['a'],
  sourceTimestamp: '00:01:00', sourceSpeaker: 'Sam', sourceQuote: 'q', ...extra,
});

describe('extraction', () => {
  it('accepts a valid payload and trims fields', () => {
    const v = validateExtraction({ title: ' Checkout ', requirements: [item(' Reset password ', { acceptanceCriteria: [' x ', ''] })] });
    expect(v).toEqual({ ok: true, value: { title: 'Checkout', requirements: [{ ...item('Reset password'), acceptanceCriteria: ['x'] }] } });
  });

  it.each([
    [null, 'Expected a JSON object'],
    [[], 'Expected a JSON object'],
    [{ requirements: 'x' }, 'must be an array'],
    [{ requirements: [null] }, 'requirements[0] must be an object'],
    [{ requirements: [item('')] }, 'title is missing'],
    [{ requirements: [item('t', { type: 'epic' })] }, 'type "epic"'],
    [{ requirements: [item('t', { priority: 'p0' })] }, 'priority "p0"'],
    [{ requirements: [item('t', { acceptanceCriteria: [1] })] }, 'list of strings'],
  ])('rejects %j', (raw, msg) => {
    const v = validateExtraction(raw);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toContain(msg);
  });

  it('defaults missing optional strings', () => {
    const v = validateExtraction({ requirements: [{ title: 't', type: 'assumption', priority: 'could' }] });
    expect(v.ok && v.value.requirements[0]).toMatchObject({ description: '', acceptanceCriteria: [], sourceQuote: '' });
  });

  it('merges chunks and drops repeated titles', () => {
    const a: Extraction = { title: '', requirements: [item('Reset Password') as never] };
    const b: Extraction = { title: 'Checkout', requirements: [item('reset password!') as never, item('Export CSV') as never] };
    const merged = mergeExtractions([a, b]);
    expect(merged.title).toBe('Checkout');
    expect(merged.requirements.map(r => r.title)).toEqual(['Reset Password', 'Export CSV']);
  });

  it('builds a draft requirements doc carrying meeting metadata', () => {
    const v = validateExtraction({ title: '', requirements: [item('Reset'), item('Export', { sourceTimestamp: '', sourceSpeaker: '', sourceQuote: '' })] });
    if (!v.ok) throw new Error(v.error);
    const doc = buildRequirementsDoc(v.value, { source: 'zoom', meetingId: '123456789', topic: 'Sync', transcript: 't' });
    expect(doc.meta).toMatchObject({ title: 'Sync', source: 'zoom', meetingId: '123456789', meetingTopic: 'Sync', nextId: 3 });
    expect(doc.requirements[0]).toMatchObject({ id: 'REQ-001', status: 'draft', source: { timestamp: '00:01:00', speaker: 'Sam', quote: 'q' } });
    expect(doc.requirements[1]).not.toHaveProperty('source');
  });

  it('schema is strict-mode compatible (every property required, no extras)', () => {
    const check = (s: any) => {
      if (s.type === 'object') {
        expect(s.additionalProperties).toBe(false);
        expect([...s.required].sort()).toEqual(Object.keys(s.properties).sort());
        Object.values(s.properties).forEach(check);
      }
      if (s.type === 'array') check(s.items);
    };
    check(EXTRACTION_SCHEMA);
  });

  it('fences the transcript and includes the summary only in the first part', () => {
    const snap = { source: 'zoom' as const, topic: 'Sync', startTime: '2026-10-20', transcript: 't', summary: 'S' };
    const first = buildExtractionUserMessage(snap, 'chunk-1', { index: 0, total: 2 });
    const second = buildExtractionUserMessage(snap, 'chunk-2', { index: 1, total: 2 });
    expect(first).toContain('<transcript>\nchunk-1\n</transcript>');
    expect(first).toContain('<meeting_summary>\nS\n</meeting_summary>');
    expect(first).toContain('part 1 of 2');
    expect(second).not.toContain('meeting_summary');
    expect(EXTRACTION_SYSTEM_PROMPT).toMatch(/data, not instructions/);
  });
});
