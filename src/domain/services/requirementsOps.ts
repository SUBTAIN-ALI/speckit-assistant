import {
  Requirement,
  RequirementInput,
  RequirementsDoc,
  REQUIREMENT_TYPES,
  REQUIREMENT_PRIORITIES,
  REQUIREMENT_STATUSES,
  isSafeName,
} from '../models/requirements';
import { formatId, idNumber } from './requirementsMarkdown';

// Pure operations on a RequirementsDoc. Each returns a new doc; ids come from
// meta.nextId and are never reused, even after a delete.

export class RequirementError extends Error {}

function cleanInput(input: RequirementInput): RequirementInput {
  const out: RequirementInput = {};
  if (input.title !== undefined) {
    if (typeof input.title !== 'string' || !input.title.trim()) throw new RequirementError('Title is required');
    out.title = input.title.trim();
  }
  if (input.type !== undefined) {
    if (!REQUIREMENT_TYPES.includes(input.type)) throw new RequirementError(`Invalid type: ${input.type}`);
    out.type = input.type;
  }
  if (input.priority !== undefined) {
    if (!REQUIREMENT_PRIORITIES.includes(input.priority)) throw new RequirementError(`Invalid priority: ${input.priority}`);
    out.priority = input.priority;
  }
  if (input.status !== undefined) {
    if (!REQUIREMENT_STATUSES.includes(input.status)) throw new RequirementError(`Invalid status: ${input.status}`);
    out.status = input.status;
  }
  if (input.description !== undefined) {
    if (typeof input.description !== 'string') throw new RequirementError('Description must be text');
    out.description = input.description;
  }
  if (input.acceptanceCriteria !== undefined) {
    if (!Array.isArray(input.acceptanceCriteria) || input.acceptanceCriteria.some(a => typeof a !== 'string')) {
      throw new RequirementError('Acceptance criteria must be a list of text');
    }
    out.acceptanceCriteria = input.acceptanceCriteria.map(a => a.trim()).filter(Boolean);
  }
  if (input.feature !== undefined) {
    if (input.feature === null || input.feature === '') out.feature = undefined;
    else if (!isSafeName(input.feature)) throw new RequirementError(`Invalid feature name: ${String(input.feature)}`);
    else out.feature = input.feature;
  }
  if (input.source !== undefined) {
    const s = input.source;
    if (s === null || typeof s !== 'object') {
      out.source = undefined;
    } else {
      const src = {
        timestamp: typeof s.timestamp === 'string' && s.timestamp.trim() ? s.timestamp.trim() : undefined,
        speaker: typeof s.speaker === 'string' && s.speaker.trim() ? s.speaker.trim() : undefined,
        quote: typeof s.quote === 'string' && s.quote.trim() ? s.quote.trim() : undefined,
      };
      out.source = src.timestamp || src.speaker || src.quote ? src : undefined;
    }
  }
  return out;
}

function find(doc: RequirementsDoc, id: string): number {
  const i = doc.requirements.findIndex(r => r.id === id);
  if (i === -1) throw new RequirementError(`Requirement not found: ${id}`);
  return i;
}

export function addRequirement(
  doc: RequirementsDoc,
  input: RequirementInput,
  index?: number
): { doc: RequirementsDoc; requirement: Requirement } {
  const clean = cleanInput({ ...input, title: input.title ?? '' });
  const requirement: Requirement = {
    id: formatId(doc.meta.nextId),
    title: clean.title!,
    type: clean.type ?? 'functional',
    priority: clean.priority ?? 'should',
    status: clean.status ?? 'draft',
    description: clean.description ?? '',
    acceptanceCriteria: clean.acceptanceCriteria ?? [],
    ...(clean.source ? { source: clean.source } : {}),
    ...(clean.feature ? { feature: clean.feature } : {}),
  };
  const list = [...doc.requirements];
  const at = index === undefined ? list.length : Math.max(0, Math.min(index, list.length));
  list.splice(at, 0, requirement);
  return { doc: { meta: { ...doc.meta, nextId: doc.meta.nextId + 1 }, requirements: list }, requirement };
}

export function updateRequirement(doc: RequirementsDoc, id: string, patch: RequirementInput): RequirementsDoc {
  const i = find(doc, id);
  const clean = cleanInput(patch);
  const updated: Requirement = { ...doc.requirements[i], ...clean };
  if ('source' in clean && !clean.source) delete updated.source;
  if ('feature' in clean && !clean.feature) delete updated.feature;
  const list = [...doc.requirements];
  list[i] = updated;
  return { ...doc, requirements: list };
}

export function deleteRequirement(
  doc: RequirementsDoc,
  id: string
): { doc: RequirementsDoc; removed: Requirement; index: number } {
  const index = find(doc, id);
  const list = [...doc.requirements];
  const [removed] = list.splice(index, 1);
  return { doc: { ...doc, requirements: list }, removed, index };
}

// Puts back a requirement removed by deleteRequirement (undo). Keeps its id;
// refuses if the id has since been taken.
export function restoreRequirement(doc: RequirementsDoc, requirement: Requirement, index: number): RequirementsDoc {
  if (doc.requirements.some(r => r.id === requirement.id)) {
    throw new RequirementError(`Requirement already exists: ${requirement.id}`);
  }
  const clean = cleanInput(requirement);
  const restored: Requirement = { ...requirement, ...clean, id: requirement.id };
  const list = [...doc.requirements];
  list.splice(Math.max(0, Math.min(index, list.length)), 0, restored);
  const nextId = Math.max(doc.meta.nextId, idNumber(requirement.id) + 1);
  return { meta: { ...doc.meta, nextId }, requirements: list };
}

// Reorders to match `ids`, which must be a permutation of the current ids.
export function reorderRequirements(doc: RequirementsDoc, ids: string[]): RequirementsDoc {
  const current = doc.requirements.map(r => r.id);
  const sameSet = ids.length === current.length && new Set(ids).size === ids.length && ids.every(id => current.includes(id));
  if (!sameSet) throw new RequirementError('Reorder must list every requirement exactly once');
  const byId = new Map(doc.requirements.map(r => [r.id, r]));
  return { ...doc, requirements: ids.map(id => byId.get(id)!) };
}

// Appends a batch of new requirements (e.g. from a re-import), each with a fresh id.
export function appendRequirements(doc: RequirementsDoc, inputs: RequirementInput[]): RequirementsDoc {
  let next = doc;
  for (const input of inputs) next = addRequirement(next, input).doc;
  return next;
}
