import * as yaml from 'js-yaml';
import {
  Requirement,
  RequirementsDoc,
  RequirementsMeta,
  RequirementSource,
  REQUIREMENT_TYPES,
  REQUIREMENT_PRIORITIES,
  REQUIREMENT_STATUSES,
} from '../models/requirements';

// On-disk format of requirements.md. Pure parse/serialize so the UI, the import
// pipeline and hand edits all agree on one shape:
//
//   ---
//   title: Checkout redesign
//   source: zoom
//   meetingId: "85012345678"
//   nextId: 3
//   ---
//
//   # Requirements: Checkout redesign
//
//   ## REQ-001 · Users can reset password via email
//   - type: functional
//   - priority: must
//   - status: draft
//   - feature: 005-password-reset        (once turned into a feature)
//   - source: [00:12:41] Sarah: "we keep getting tickets about locked accounts"
//
//   Users who forget their password receive a reset link.
//
//   **Acceptance criteria**
//   - Link expires after 30 minutes
//
// Parsing is lenient (unknown enum values fall back to defaults, a heading
// without an id gets one assigned) so a hand-edited file never fails to load.
// serialize(parse(x)) is stable, and parse(serialize(doc)) round-trips doc.

const HEADING_RE = /^##\s+(?:(REQ-\d+)\s*[·:\-–—]\s*)?(.*)$/;
const META_RE = /^-\s+(type|priority|status|source|feature):\s*(.*)$/i;
const AC_HEADING_RE = /^\*\*Acceptance criteria\*\*\s*$/i;
const SOURCE_RE = /^(?:\[([^\]]*)\]\s*)?(?:([^:"]+?):\s*)?"([\s\S]*)"$/;

export function formatId(n: number): string {
  return `REQ-${String(n).padStart(3, '0')}`;
}

export function idNumber(id: string): number {
  const m = /^REQ-(\d+)$/.exec(id);
  return m ? parseInt(m[1], 10) : 0;
}

function pick<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  const v = (value ?? '').trim().toLowerCase() as T;
  return allowed.includes(v) ? v : fallback;
}

export function formatSource(s: RequirementSource | undefined): string {
  if (!s || (!s.timestamp && !s.speaker && !s.quote)) return '';
  const parts: string[] = [];
  if (s.timestamp) parts.push(`[${s.timestamp}]`);
  if (s.speaker) parts.push(`${s.speaker}:`);
  parts.push(`"${s.quote ?? ''}"`);
  return parts.join(' ');
}

export function parseSource(raw: string): RequirementSource | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  const m = SOURCE_RE.exec(text);
  if (!m) return { quote: text };
  const src: RequirementSource = {};
  if (m[1]) src.timestamp = m[1].trim();
  if (m[2]) src.speaker = m[2].trim();
  src.quote = m[3];
  return src;
}

function splitFrontmatter(md: string): { front: Record<string, unknown>; body: string } {
  const text = md.replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return { front: {}, body: text };
  let front: Record<string, unknown> = {};
  try {
    const loaded = yaml.load(m[1]);
    if (loaded && typeof loaded === 'object' && !Array.isArray(loaded)) front = loaded as Record<string, unknown>;
  } catch {
    front = {};
  }
  return { front, body: text.slice(m[0].length) };
}

const str = (v: unknown): string | undefined =>
  v === undefined || v === null || v === '' ? undefined : String(v);

function parseSection(id: string, title: string, lines: string[]): Requirement {
  const req: Requirement = {
    id,
    title: title.trim(),
    type: 'functional',
    priority: 'should',
    status: 'draft',
    description: '',
    acceptanceCriteria: [],
  };

  let i = 0;
  // Metadata bullets directly under the heading (blank lines allowed before them).
  while (i < lines.length && lines[i].trim() === '') i++;
  while (i < lines.length) {
    const m = META_RE.exec(lines[i].trim());
    if (!m) break;
    const key = m[1].toLowerCase();
    const value = m[2];
    if (key === 'type') req.type = pick(value, REQUIREMENT_TYPES, 'functional');
    else if (key === 'priority') req.priority = pick(value, REQUIREMENT_PRIORITIES, 'should');
    else if (key === 'status') req.status = pick(value, REQUIREMENT_STATUSES, 'draft');
    else if (key === 'source') {
      const src = parseSource(value);
      if (src) req.source = src;
    } else if (key === 'feature') {
      const f = value.trim();
      if (f) req.feature = f;
    }
    i++;
  }

  const rest = lines.slice(i);
  const acIndex = rest.findIndex(l => AC_HEADING_RE.test(l.trim()));
  const descLines = acIndex === -1 ? rest : rest.slice(0, acIndex);
  req.description = descLines.join('\n').trim();

  if (acIndex !== -1) {
    for (const line of rest.slice(acIndex + 1)) {
      const m = /^\s*[-*]\s+(?:\[[ xX]\]\s+)?(.*)$/.exec(line);
      if (m && m[1].trim()) req.acceptanceCriteria.push(m[1].trim());
    }
  }
  return req;
}

export function parseRequirements(md: string): RequirementsDoc {
  const { front, body } = splitFrontmatter(md);
  const lines = body.split('\n');

  const sections: Array<{ id: string; title: string; lines: string[] }> = [];
  let docTitle: string | undefined;
  let current: { id: string; title: string; lines: string[] } | null = null;
  let inFence = false;

  for (const line of lines) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (!inFence) {
      const h = HEADING_RE.exec(line);
      if (h) {
        current = { id: h[1] ?? '', title: h[2] ?? '', lines: [] };
        sections.push(current);
        continue;
      }
      if (!current && /^#\s+/.test(line) && docTitle === undefined) {
        docTitle = line.replace(/^#\s+/, '').replace(/^Requirements:\s*/i, '').trim();
        continue;
      }
    }
    if (current) current.lines.push(line);
  }

  const requirements = sections.map(s => parseSection(s.id, s.title, s.lines));

  const frontNext = Number(front.nextId);
  let nextId = Number.isFinite(frontNext) && frontNext > 0 ? Math.floor(frontNext) : 1;
  for (const r of requirements) nextId = Math.max(nextId, idNumber(r.id) + 1);

  // Hand-written headings without an id (or duplicated ids) get a fresh one.
  const seen = new Set<string>();
  for (const r of requirements) {
    if (!r.id || seen.has(r.id)) r.id = formatId(nextId++);
    seen.add(r.id);
  }

  const source = str(front.source);
  const meta: RequirementsMeta = {
    title: str(front.title) ?? docTitle,
    source: source === 'zoom' || source === 'upload' || source === 'manual' ? source : undefined,
    meetingId: str(front.meetingId),
    meetingTopic: str(front.meetingTopic),
    meetingDate: str(front.meetingDate),
    setId: str(front.setId),
    nextId,
  };
  return { meta, requirements };
}

export function serializeRequirements(doc: RequirementsDoc): string {
  const front: Record<string, unknown> = {};
  const { meta } = doc;
  if (meta.title) front.title = meta.title;
  if (meta.source) front.source = meta.source;
  if (meta.meetingId) front.meetingId = meta.meetingId;
  if (meta.meetingTopic) front.meetingTopic = meta.meetingTopic;
  if (meta.meetingDate) front.meetingDate = meta.meetingDate;
  if (meta.setId) front.setId = meta.setId;
  front.nextId = meta.nextId;

  // Quote every string so ids like 85012345678 stay strings and dates stay text.
  const out: string[] = ['---', yaml.dump(front, { lineWidth: -1, forceQuotes: true, quotingType: '"' }).trimEnd(), '---', ''];
  out.push(`# Requirements${meta.title ? `: ${meta.title}` : ''}`, '');

  for (const r of doc.requirements) {
    // Headings are single-line; collapse any newline a caller may have sent.
    out.push(`## ${r.id} · ${r.title.replace(/\s*\n\s*/g, ' ').trim()}`);
    out.push(`- type: ${r.type}`);
    out.push(`- priority: ${r.priority}`);
    out.push(`- status: ${r.status}`);
    if (r.feature) out.push(`- feature: ${r.feature}`);
    const src = formatSource(r.source);
    if (src) out.push(`- source: ${src.replace(/\n/g, ' ')}`);
    out.push('');
    if (r.description.trim()) out.push(r.description.trim(), '');
    if (r.acceptanceCriteria.length > 0) {
      out.push('**Acceptance criteria**');
      for (const ac of r.acceptanceCriteria) out.push(`- ${ac.replace(/\n/g, ' ')}`);
      out.push('');
    }
  }
  return out.join('\n').trimEnd() + '\n';
}

export function emptyRequirementsDoc(meta: Partial<RequirementsMeta> = {}): RequirementsDoc {
  return { meta: { nextId: 1, ...meta }, requirements: [] };
}
