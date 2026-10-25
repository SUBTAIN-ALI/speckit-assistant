import {
  RequirementInput,
  RequirementsDoc,
  RequirementsMeta,
  REQUIREMENT_TYPES,
  REQUIREMENT_PRIORITIES,
} from '../models/requirements';
import { MeetingSnapshot } from '../models/meeting';
import { appendRequirements } from './requirementsOps';
import { emptyRequirementsDoc } from './requirementsMarkdown';

// The JSON contract between the app and the LLM. The model never writes
// requirements.md directly: it returns this shape (enforced by each provider's
// structured-output mode), the app validates it, then serializes the markdown.
//
// The schema stays inside the subset all three providers accept in strict mode:
// every property required, additionalProperties false, no nulls (empty string
// means "unknown").

export type ExtractedRequirement = {
  title: string;
  type: typeof REQUIREMENT_TYPES[number];
  priority: typeof REQUIREMENT_PRIORITIES[number];
  description: string;
  acceptanceCriteria: string[];
  sourceTimestamp: string;
  sourceSpeaker: string;
  sourceQuote: string;
};

export type Extraction = {
  title: string;
  requirements: ExtractedRequirement[];
};

export const EXTRACTION_SCHEMA_NAME = 'meeting_requirements';

export const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'requirements'],
  properties: {
    title: { type: 'string', description: 'Short name for this set of requirements (e.g. the product or feature discussed).' },
    requirements: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'type', 'priority', 'description', 'acceptanceCriteria', 'sourceTimestamp', 'sourceSpeaker', 'sourceQuote'],
        properties: {
          title: { type: 'string' },
          type: { type: 'string', enum: [...REQUIREMENT_TYPES] },
          priority: { type: 'string', enum: [...REQUIREMENT_PRIORITIES] },
          description: { type: 'string' },
          acceptanceCriteria: { type: 'array', items: { type: 'string' } },
          sourceTimestamp: { type: 'string' },
          sourceSpeaker: { type: 'string' },
          sourceQuote: { type: 'string' },
        },
      },
    },
  },
} as const;

export type ValidationResult = { ok: true; value: Extraction } | { ok: false; error: string };

export function validateExtraction(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Expected a JSON object' };
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.requirements)) return { ok: false, error: '"requirements" must be an array' };

  const out: ExtractedRequirement[] = [];
  for (let i = 0; i < obj.requirements.length; i++) {
    const r = obj.requirements[i] as Record<string, unknown>;
    const at = `requirements[${i}]`;
    if (!r || typeof r !== 'object') return { ok: false, error: `${at} must be an object` };
    if (typeof r.title !== 'string' || !r.title.trim()) return { ok: false, error: `${at}.title is missing` };
    if (!REQUIREMENT_TYPES.includes(r.type as never)) return { ok: false, error: `${at}.type "${String(r.type)}" is not one of ${REQUIREMENT_TYPES.join(', ')}` };
    if (!REQUIREMENT_PRIORITIES.includes(r.priority as never)) return { ok: false, error: `${at}.priority "${String(r.priority)}" is not one of ${REQUIREMENT_PRIORITIES.join(', ')}` };
    const ac = r.acceptanceCriteria ?? [];
    if (!Array.isArray(ac) || ac.some(a => typeof a !== 'string')) return { ok: false, error: `${at}.acceptanceCriteria must be a list of strings` };
    const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    out.push({
      title: r.title.trim(),
      type: r.type as ExtractedRequirement['type'],
      priority: r.priority as ExtractedRequirement['priority'],
      description: s(r.description),
      acceptanceCriteria: (ac as string[]).map(a => a.trim()).filter(Boolean),
      sourceTimestamp: s(r.sourceTimestamp),
      sourceSpeaker: s(r.sourceSpeaker),
      sourceQuote: s(r.sourceQuote),
    });
  }
  return { ok: true, value: { title: typeof obj.title === 'string' ? obj.title.trim() : '', requirements: out } };
}

export function toRequirementInputs(extraction: Extraction): RequirementInput[] {
  return extraction.requirements.map(r => ({
    title: r.title,
    type: r.type,
    priority: r.priority,
    status: 'draft',
    description: r.description,
    acceptanceCriteria: r.acceptanceCriteria,
    source: { timestamp: r.sourceTimestamp, speaker: r.sourceSpeaker, quote: r.sourceQuote },
  }));
}

const normTitle = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Combines per-chunk extractions of a long meeting, dropping requirements whose
// titles repeat across chunks (the first occurrence wins).
export function mergeExtractions(parts: Extraction[]): Extraction {
  const seen = new Set<string>();
  const requirements: ExtractedRequirement[] = [];
  for (const part of parts) {
    for (const r of part.requirements) {
      const key = normTitle(r.title);
      if (seen.has(key)) continue;
      seen.add(key);
      requirements.push(r);
    }
  }
  return { title: parts.find(p => p.title)?.title ?? '', requirements };
}

export function buildRequirementsDoc(extraction: Extraction, snapshot: MeetingSnapshot): RequirementsDoc {
  const meta: Partial<RequirementsMeta> = {
    title: extraction.title || snapshot.topic || undefined,
    source: snapshot.source,
    meetingId: snapshot.meetingId,
    meetingTopic: snapshot.topic,
    meetingDate: snapshot.startTime,
  };
  return appendRequirements(emptyRequirementsDoc(meta), toRequirementInputs(extraction));
}
