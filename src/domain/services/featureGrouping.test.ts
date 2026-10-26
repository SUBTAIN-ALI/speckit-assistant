import { describe, it, expect } from 'vitest';
import { featureDirName, normalizeGrouping, slugify, validateGroups, groupingUserMessage, GROUPING_SCHEMA } from './featureGrouping';
import { appendRequirements } from './requirementsOps';
import { emptyRequirementsDoc } from './requirementsMarkdown';
import { buildSpecPrompt } from './specPrompt';

const doc = appendRequirements(emptyRequirementsDoc({ meetingTopic: 'Weekly sync', meetingDate: '2026-10-20' }), [
  { title: 'Reset password', status: 'accepted', priority: 'must', description: 'Self-service reset.', acceptanceCriteria: ['Link expires in 30 min'], source: { timestamp: '00:00:05', speaker: 'Sarah', quote: 'locked out' } },
  { title: 'CSV export', status: 'accepted' },
  { title: 'SSO?', type: 'open-question', status: 'accepted' },
  { title: 'Already built', status: 'accepted', feature: '004-old' },
]);

describe('featureGrouping', () => {
  it('slugifies and numbers features like Spec Kit', () => {
    expect(slugify('  Self-service Password Reset! ')).toBe('self-service-password-reset');
    expect(featureDirName('Password reset', [])).toBe('001-password-reset');
    expect(featureDirName('007-password reset', ['001-a', '012-b', 'notes'])).toBe('013-password-reset');
    expect(featureDirName('!!!', ['003-x'])).toBe('004-feature');
  });

  it('cleans up the model proposal', () => {
    const raw = { features: [
      { name: 'Password Reset', title: 'Password reset', summary: ' Reset. ', requirementIds: ['REQ-001', 'REQ-003', 'REQ-999'] },
      { name: '', title: 'Export', requirementIds: ['REQ-001', 'REQ-002'] },
      { name: 'empty', title: 'Empty', requirementIds: [] },
      'junk',
    ] };
    expect(normalizeGrouping(raw, ['REQ-001', 'REQ-002', 'REQ-003', 'REQ-005'])).toEqual({
      groups: [
        { name: 'password-reset', title: 'Password reset', summary: 'Reset.', requirementIds: ['REQ-001', 'REQ-003'] },
        { name: 'export', title: 'Export', summary: undefined, requirementIds: ['REQ-002'] },
      ],
      unassigned: ['REQ-005'],
    });
    expect(normalizeGrouping(null, ['REQ-001'])).toEqual({ groups: [], unassigned: ['REQ-001'] });
  });

  it('validates groups from the client', () => {
    const ok = validateGroups([{ name: 'Auth', title: 'Auth', requirementIds: ['REQ-001', 'REQ-003'] }, { title: 'CSV export', requirementIds: ['REQ-002'] }], doc);
    expect(ok).toEqual({ ok: true, groups: [
      { name: 'auth', title: 'Auth', summary: undefined, requirementIds: ['REQ-001', 'REQ-003'] },
      { name: 'csv-export', title: 'CSV export', summary: undefined, requirementIds: ['REQ-002'] },
    ] });
    const err = (g: unknown) => { const v = validateGroups(g, doc); return v.ok ? '' : v.error; };
    expect(err([])).toMatch(/at least one/);
    expect(err([{ title: '', name: '', requirementIds: ['REQ-001'] }])).toMatch(/needs a name/);
    expect(err([{ title: 'A', requirementIds: [] }])).toMatch(/no requirements/);
    expect(err([{ title: 'A', requirementIds: ['REQ-404'] }])).toMatch(/Unknown requirement/);
    expect(err([{ title: 'A', requirementIds: ['REQ-001'] }, { title: 'B', requirementIds: ['REQ-001'] }])).toMatch(/more than one/);
    expect(err([{ title: 'A', requirementIds: ['REQ-004'] }])).toMatch(/already part of feature 004-old/);
    const withWont = appendRequirements(doc, [{ title: 'Tipping', priority: 'wont', status: 'accepted' }]);
    const v = validateGroups([{ title: 'A', requirementIds: ['REQ-005'] }], withWont);
    expect(v.ok ? '' : v.error).toMatch(/won’t-have/);
  });

  it('fences the requirements in the grouping prompt; schema is strict-compatible', () => {
    const msg = groupingUserMessage(doc, doc.requirements.slice(0, 2));
    expect(msg).toContain('Meeting: Weekly sync');
    expect(msg).toContain('<requirements>\nREQ-001 [functional, must] Reset password — Self-service reset.\nREQ-002 [functional, should] CSV export\n</requirements>');
    const item = GROUPING_SCHEMA.properties.features.items;
    expect([...item.required].sort()).toEqual(Object.keys(item.properties).sort());
  });
});

describe('buildSpecPrompt', () => {
  it('turns requirements into the Specify input with traceability rules', () => {
    const p = buildSpecPrompt({ feature: '005-password-reset', title: 'Password reset', summary: 'Let users reset passwords.', meta: doc.meta, requirements: doc.requirements.slice(0, 3) });
    expect(p).toContain('Create the feature specification for "Password reset" — Let users reset passwords.');
    expect(p).toContain('in the meeting "Weekly sync, 2026-10-20"');
    expect(p).toContain('write the specification to specs/005-password-reset/spec.md. Do not create another feature directory or branch.');
    expect(p).toContain('Keep its ID (e.g. REQ-003)');
    expect(p).toContain('REQ-001 (functional, must): Reset password\n  Self-service reset.\n  Acceptance criteria:\n  - Link expires in 30 min\n  Source: [00:00:05] Sarah: "locked out"');
    // Open questions are separated and must not be decided.
    expect(p).toContain('[NEEDS CLARIFICATION');
    expect(p).toContain('Open questions and assumptions:\nREQ-003 (open-question, should): SSO?');
    expect(p).toContain('specs/005-password-reset/requirements.md');
    expect(p.trim().endsWith('</requirements>')).toBe(true);
  });

  it('omits the clarification rule when nothing is open', () => {
    const p = buildSpecPrompt({ feature: '001-x', title: 'X', meta: { nextId: 1 }, requirements: doc.requirements.slice(1, 2) });
    expect(p).not.toContain('NEEDS CLARIFICATION');
    expect(p).not.toContain('meeting "');
  });
});
