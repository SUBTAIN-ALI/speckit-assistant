import { describe, it, expect } from 'vitest';
import {
  parseRequirements,
  serializeRequirements,
  parseSource,
  formatSource,
  formatId,
  emptyRequirementsDoc,
} from './requirementsMarkdown';
import { RequirementsDoc } from '../models/requirements';

const DOC: RequirementsDoc = {
  meta: {
    title: 'Checkout redesign',
    source: 'zoom',
    meetingId: '85012345678',
    meetingTopic: 'Weekly sync: checkout',
    meetingDate: '2026-10-20T15:00:00Z',
    nextId: 4,
  },
  requirements: [
    {
      id: 'REQ-001',
      title: 'Users can reset password via email',
      type: 'functional',
      priority: 'must',
      status: 'accepted',
      description: 'Users who forget their password receive a reset link.\n\nThe link is single-use.',
      acceptanceCriteria: ['Link expires after 30 minutes', 'Old password stops working after reset'],
      source: { timestamp: '00:12:41', speaker: 'Sarah', quote: 'we keep getting "locked out" tickets' },
    },
    {
      id: 'REQ-003',
      title: 'Checkout page loads in under 2 seconds',
      type: 'non-functional',
      priority: 'should',
      status: 'draft',
      description: '',
      acceptanceCriteria: [],
    },
  ],
};

describe('requirementsMarkdown', () => {
  it('round-trips a document exactly', () => {
    const md = serializeRequirements(DOC);
    expect(parseRequirements(md)).toEqual(DOC);
  });

  it('is stable: serialize(parse(serialize(doc))) === serialize(doc)', () => {
    const md = serializeRequirements(DOC);
    expect(serializeRequirements(parseRequirements(md))).toBe(md);
  });

  it('keeps numeric-looking meeting ids as strings', () => {
    const md = serializeRequirements(DOC);
    expect(md).toContain('meetingId: "85012345678"');
    expect(parseRequirements(md).meta.meetingId).toBe('85012345678');
  });

  it('writes the documented layout', () => {
    const md = serializeRequirements(DOC);
    expect(md).toContain('# Requirements: Checkout redesign');
    expect(md).toContain('## REQ-001 · Users can reset password via email');
    expect(md).toContain('- priority: must');
    expect(md).toContain('- source: [00:12:41] Sarah: "we keep getting "locked out" tickets"');
    expect(md).toContain('**Acceptance criteria**\n- Link expires after 30 minutes');
  });

  it('parses a hand-written file leniently', () => {
    const md = [
      '# Requirements: Notes',
      '',
      '## REQ-002 - Export to CSV',
      '- type: FUNCTIONAL',
      '- priority: urgent',
      '',
      'Admins export the order list.',
      '',
      '## Dark mode',
      'Nice to have.',
      '',
      '**Acceptance criteria**',
      '* [x] Respects the OS setting',
    ].join('\n');
    const doc = parseRequirements(md);
    expect(doc.meta.title).toBe('Notes');
    expect(doc.requirements).toHaveLength(2);
    const [csv, dark] = doc.requirements;
    expect(csv).toMatchObject({ id: 'REQ-002', title: 'Export to CSV', type: 'functional', priority: 'should', status: 'draft', description: 'Admins export the order list.' });
    // Heading without an id gets the next free one.
    expect(dark).toMatchObject({ id: 'REQ-003', title: 'Dark mode', description: 'Nice to have.', acceptanceCriteria: ['Respects the OS setting'] });
    expect(doc.meta.nextId).toBe(4);
  });

  it('re-ids duplicate ids and never lets nextId go backwards', () => {
    const md = ['---', 'nextId: 2', '---', '## REQ-005 · A', '## REQ-005 · B'].join('\n');
    const doc = parseRequirements(md);
    expect(doc.requirements.map(r => r.id)).toEqual(['REQ-005', 'REQ-006']);
    expect(doc.meta.nextId).toBe(7);
  });

  it('ignores ## headings inside code fences', () => {
    const md = ['## REQ-001 · Config', '', '```', '## not a heading', '```'].join('\n');
    const doc = parseRequirements(md);
    expect(doc.requirements).toHaveLength(1);
    expect(doc.requirements[0].description).toContain('## not a heading');
  });

  it('tolerates broken frontmatter and CRLF line endings', () => {
    const md = '---\r\n: : bad yaml [\r\n---\r\n## REQ-001 · A\r\n- status: rejected\r\n';
    const doc = parseRequirements(md);
    expect(doc.requirements[0]).toMatchObject({ title: 'A', status: 'rejected' });
    expect(doc.meta.nextId).toBe(2);
  });

  it('serializes an empty doc and parses it back', () => {
    const md = serializeRequirements(emptyRequirementsDoc({ title: 'x' }));
    expect(parseRequirements(md)).toEqual({ meta: { title: 'x', nextId: 1 }, requirements: [] });
  });

  it('collapses newlines in single-line fields', () => {
    const md = serializeRequirements({
      meta: { nextId: 2 },
      requirements: [{ ...DOC.requirements[1], id: 'REQ-001', title: 'Two\nlines', acceptanceCriteria: ['a\nb'] }],
    });
    const r = parseRequirements(md).requirements[0];
    expect(r.title).toBe('Two lines');
    expect(r.acceptanceCriteria).toEqual(['a b']);
  });

  describe('source', () => {
    it('formats and parses all parts', () => {
      const s = { timestamp: '01:02:03', speaker: 'Ali', quote: 'ship it' };
      expect(parseSource(formatSource(s))).toEqual(s);
    });
    it('handles a quote alone or free text', () => {
      expect(parseSource('"just a quote"')).toEqual({ quote: 'just a quote' });
      expect(parseSource('said in passing')).toEqual({ quote: 'said in passing' });
      expect(parseSource('  ')).toBeUndefined();
      expect(formatSource({})).toBe('');
    });
  });

  it('pads ids', () => {
    expect(formatId(7)).toBe('REQ-007');
    expect(formatId(1234)).toBe('REQ-1234');
  });
});
