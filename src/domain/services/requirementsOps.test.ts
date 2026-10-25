import { describe, it, expect } from 'vitest';
import {
  addRequirement,
  updateRequirement,
  deleteRequirement,
  restoreRequirement,
  reorderRequirements,
  appendRequirements,
  RequirementError,
} from './requirementsOps';
import { emptyRequirementsDoc } from './requirementsMarkdown';

const base = () => appendRequirements(emptyRequirementsDoc(), [{ title: 'A' }, { title: 'B' }, { title: 'C' }]);

describe('requirementsOps', () => {
  it('adds with defaults and sequential ids', () => {
    const doc = base();
    expect(doc.requirements.map(r => r.id)).toEqual(['REQ-001', 'REQ-002', 'REQ-003']);
    expect(doc.requirements[0]).toEqual({
      id: 'REQ-001', title: 'A', type: 'functional', priority: 'should', status: 'draft', description: '', acceptanceCriteria: [],
    });
    expect(doc.meta.nextId).toBe(4);
  });

  it('adds at an index and clamps it', () => {
    const { doc } = addRequirement(base(), { title: 'Z' }, 0);
    expect(doc.requirements[0].title).toBe('Z');
    expect(addRequirement(base(), { title: 'Y' }, 99).doc.requirements[3].title).toBe('Y');
  });

  it('never reuses an id after delete', () => {
    const { doc } = deleteRequirement(base(), 'REQ-003');
    expect(addRequirement(doc, { title: 'D' }).requirement.id).toBe('REQ-004');
  });

  it('updates any field and validates input', () => {
    const doc = updateRequirement(base(), 'REQ-002', {
      title: '  B2 ', type: 'constraint', priority: 'must', status: 'accepted',
      description: 'd', acceptanceCriteria: [' x ', ''], source: { timestamp: '00:01', quote: 'q' },
    });
    expect(doc.requirements[1]).toMatchObject({
      title: 'B2', type: 'constraint', priority: 'must', status: 'accepted', description: 'd', acceptanceCriteria: ['x'],
      source: { timestamp: '00:01', quote: 'q' },
    });
    expect(() => updateRequirement(base(), 'REQ-002', { title: ' ' })).toThrow(RequirementError);
    expect(() => updateRequirement(base(), 'REQ-002', { type: 'epic' as never })).toThrow(/Invalid type/);
    expect(() => updateRequirement(base(), 'REQ-002', { priority: 'p0' as never })).toThrow(/Invalid priority/);
    expect(() => updateRequirement(base(), 'REQ-002', { status: 'done' as never })).toThrow(/Invalid status/);
    expect(() => updateRequirement(base(), 'REQ-002', { acceptanceCriteria: [1] as never })).toThrow(/list of text/);
    expect(() => updateRequirement(base(), 'REQ-404', { title: 'x' })).toThrow(/not found/);
  });

  it('clears the source when patched with an empty one', () => {
    const withSrc = updateRequirement(base(), 'REQ-001', { source: { quote: 'q' } });
    const cleared = updateRequirement(withSrc, 'REQ-001', { source: { quote: '  ' } });
    expect(cleared.requirements[0]).not.toHaveProperty('source');
  });

  it('does not mutate the input doc', () => {
    const doc = base();
    const snapshot = JSON.stringify(doc);
    updateRequirement(doc, 'REQ-001', { title: 'changed' });
    deleteRequirement(doc, 'REQ-002');
    expect(JSON.stringify(doc)).toBe(snapshot);
  });

  it('restores a deleted requirement at its position (undo)', () => {
    const { doc, removed, index } = deleteRequirement(base(), 'REQ-002');
    const restored = restoreRequirement(doc, removed, index);
    expect(restored.requirements.map(r => r.id)).toEqual(['REQ-001', 'REQ-002', 'REQ-003']);
    expect(() => restoreRequirement(restored, removed, index)).toThrow(/already exists/);
  });

  it('bumps nextId when restoring an id beyond it', () => {
    const doc = restoreRequirement(emptyRequirementsDoc(), { ...base().requirements[2], id: 'REQ-010' }, 0);
    expect(doc.meta.nextId).toBe(11);
  });

  it('reorders only with a full permutation', () => {
    expect(reorderRequirements(base(), ['REQ-003', 'REQ-001', 'REQ-002']).requirements.map(r => r.title)).toEqual(['C', 'A', 'B']);
    expect(() => reorderRequirements(base(), ['REQ-001', 'REQ-002'])).toThrow(RequirementError);
    expect(() => reorderRequirements(base(), ['REQ-001', 'REQ-001', 'REQ-002'])).toThrow(RequirementError);
  });
});
