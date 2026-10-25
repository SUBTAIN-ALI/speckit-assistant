// Requirements captured from a meeting (or written by hand). Each import is a
// requirement *set* stored at .specify/meetings/<setId>/requirements.md (local,
// git-ignored, next to the transcript). Accepted requirements are turned into
// Spec Kit features; each linked requirement records its feature, and a copy
// of a feature's requirements is kept at specs/<feature>/requirements.md (the
// committed record of where the spec came from). The markdown files are the
// source of truth; see requirementsMarkdown.ts for the on-disk format.

export const REQUIREMENT_TYPES = ['functional', 'non-functional', 'constraint', 'assumption', 'open-question'] as const;
export const REQUIREMENT_PRIORITIES = ['must', 'should', 'could', 'wont'] as const;
export const REQUIREMENT_STATUSES = ['draft', 'accepted', 'rejected'] as const;

export type RequirementType = typeof REQUIREMENT_TYPES[number];
export type RequirementPriority = typeof REQUIREMENT_PRIORITIES[number];
export type RequirementStatus = typeof REQUIREMENT_STATUSES[number];

// Where in the meeting a requirement came from. All fields optional: hand-written
// requirements have no source.
export type RequirementSource = {
  timestamp?: string; // "00:12:41"
  speaker?: string;
  quote?: string;
};

export type Requirement = {
  id: string; // "REQ-001" — stable, never reused after delete
  title: string;
  type: RequirementType;
  priority: RequirementPriority;
  status: RequirementStatus;
  description: string;
  acceptanceCriteria: string[];
  source?: RequirementSource;
  feature?: string; // Spec Kit feature created from it, e.g. "005-order-export"
};

export type RequirementsMeta = {
  title?: string;
  source?: 'zoom' | 'upload' | 'manual';
  meetingId?: string;
  meetingTopic?: string;
  meetingDate?: string;
  setId?: string; // on a feature's copy: the requirement set it came from
  nextId: number; // next numeric id to assign
};

export type RequirementsDoc = {
  meta: RequirementsMeta;
  requirements: Requirement[];
};

// Fields a caller may set when adding or editing a requirement.
export type RequirementInput = Partial<Omit<Requirement, 'id'>>;

export const MEETINGS_DIR = '.specify/meetings';
export const REQUIREMENTS_FILE = 'requirements.md';

export function setDir(setId: string): string {
  return `${MEETINGS_DIR}/${setId}`;
}

export function requirementsPath(setId: string): string {
  return `${setDir(setId)}/${REQUIREMENTS_FILE}`;
}

// The committed copy of a feature's source requirements.
export function featureRequirementsPath(feature: string): string {
  return `specs/${feature}/${REQUIREMENTS_FILE}`;
}

// Set ids and feature names become path segments; reject anything that could
// escape their parent directory.
export function isSafeName(name: unknown): name is string {
  return typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) && !name.includes('..') && name.length <= 100;
}

// One row in the list of requirement sets.
export type RequirementSetSummary = {
  id: string;
  title: string;
  source?: RequirementsMeta['source'];
  meetingTopic?: string;
  meetingDate?: string;
  total: number;
  accepted: number;
  draft: number;
  linked: number; // already turned into features
};
