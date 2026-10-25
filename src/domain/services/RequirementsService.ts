import {
  MEETINGS_DIR,
  Requirement,
  RequirementInput,
  RequirementSetSummary,
  RequirementsDoc,
  featureRequirementsPath,
  isSafeName,
  requirementsPath,
  setDir,
} from '../models/requirements';
import { WorkspaceRepositoryPort } from '../ports/out/WorkspaceRepositoryPort';
import { emptyRequirementsDoc, parseRequirements, serializeRequirements } from './requirementsMarkdown';
import { slugify } from './featureGrouping';
import {
  RequirementError,
  addRequirement,
  deleteRequirement,
  reorderRequirements,
  restoreRequirement,
  updateRequirement,
} from './requirementsOps';

// Called when a requirement that already became a feature changes, so the
// feature's spec can be flagged out of date.
export type LinkedFeatureChanged = (workspacePath: string, feature: string) => Promise<void>;

// Fields whose change makes a linked feature's spec out of date (status and
// ordering don't change what the spec should say).
const CONTENT_FIELDS: Array<keyof Requirement> = ['title', 'type', 'priority', 'description', 'acceptanceCriteria'];

// CRUD over requirement sets at .specify/meetings/<setId>/requirements.md. Every
// operation reads the file, applies a pure op and writes it back, so edits made
// on disk (or in the raw markdown editor) are always picked up.
export class RequirementsService {
  constructor(
    private workspaceRepo: WorkspaceRepositoryPort,
    private onLinkedFeatureChanged?: LinkedFeatureChanged,
    private now: () => number = Date.now
  ) {}

  private path(setId: string): string {
    if (!isSafeName(setId)) throw new RequirementError(`Invalid requirement set: ${String(setId)}`);
    return requirementsPath(setId);
  }

  // A fresh, unused set id like "2026-10-25-checkout-sync".
  async newSetId(workspacePath: string, title: string, date?: string): Promise<string> {
    const day = (date && /^\d{4}-\d{2}-\d{2}/.test(date) ? date : new Date(this.now()).toISOString()).slice(0, 10);
    const base = `${day}-${slugify(title) || 'meeting'}`;
    const taken = new Set(await this.workspaceRepo.listDirectories(workspacePath, MEETINGS_DIR));
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    return id;
  }

  async list(workspacePath: string): Promise<RequirementSetSummary[]> {
    const ids = await this.workspaceRepo.listDirectories(workspacePath, MEETINGS_DIR);
    const out: RequirementSetSummary[] = [];
    for (const id of ids) {
      if (!isSafeName(id)) continue;
      const doc = await this.get(workspacePath, id);
      if (!doc) continue;
      const r = doc.requirements;
      out.push({
        id,
        title: doc.meta.title || doc.meta.meetingTopic || id,
        source: doc.meta.source,
        meetingTopic: doc.meta.meetingTopic,
        meetingDate: doc.meta.meetingDate,
        total: r.length,
        accepted: r.filter(x => x.status === 'accepted').length,
        draft: r.filter(x => x.status === 'draft').length,
        linked: r.filter(x => x.feature).length,
      });
    }
    // Newest first (ids start with the date).
    return out.sort((a, b) => b.id.localeCompare(a.id));
  }

  // null when the set has no requirements file.
  async get(workspacePath: string, setId: string): Promise<RequirementsDoc | null> {
    const md = await this.workspaceRepo.readFile(workspacePath, this.path(setId));
    return md.trim() ? parseRequirements(md) : null;
  }

  async save(workspacePath: string, setId: string, doc: RequirementsDoc): Promise<RequirementsDoc> {
    await this.workspaceRepo.writeFile(workspacePath, this.path(setId), serializeRequirements(doc));
    return doc;
  }

  // A new, empty set for writing requirements by hand.
  async create(workspacePath: string, title: string): Promise<{ id: string; doc: RequirementsDoc }> {
    const name = title.trim() || 'Requirements';
    const id = await this.newSetId(workspacePath, name);
    const doc = await this.save(workspacePath, id, emptyRequirementsDoc({ title: name, source: 'manual' }));
    return { id, doc };
  }

  // Deletes the set and its meeting files. Features already created from it keep
  // their own copy of the requirements.
  async deleteSet(workspacePath: string, setId: string): Promise<void> {
    this.path(setId);
    await this.workspaceRepo.deleteDirectory(workspacePath, setDir(setId));
  }

  private async load(workspacePath: string, setId: string): Promise<RequirementsDoc> {
    const doc = await this.get(workspacePath, setId);
    if (!doc) throw new RequirementError(`Requirement set not found: ${setId}`);
    return doc;
  }

  async add(workspacePath: string, setId: string, input: RequirementInput, index?: number): Promise<{ doc: RequirementsDoc; requirement: Requirement }> {
    const result = addRequirement(await this.load(workspacePath, setId), input, index);
    await this.save(workspacePath, setId, result.doc);
    if (result.requirement.feature) await this.syncFeature(workspacePath, setId, result.doc, result.requirement.feature);
    return result;
  }

  async update(workspacePath: string, setId: string, id: string, patch: RequirementInput): Promise<RequirementsDoc> {
    const before = await this.load(workspacePath, setId);
    const old = before.requirements.find(r => r.id === id);
    const doc = await this.save(workspacePath, setId, updateRequirement(before, id, patch));
    const now = doc.requirements.find(r => r.id === id)!;

    const contentChanged = CONTENT_FIELDS.some(k => JSON.stringify(old?.[k]) !== JSON.stringify(now[k]));
    const features = new Set([old?.feature, now.feature].filter((f): f is string => !!f));
    if (old?.feature !== now.feature || (contentChanged && now.feature)) {
      for (const f of features) await this.syncFeature(workspacePath, setId, doc, f);
    }
    return doc;
  }

  async remove(workspacePath: string, setId: string, id: string): Promise<{ doc: RequirementsDoc; removed: Requirement; index: number }> {
    const result = deleteRequirement(await this.load(workspacePath, setId), id);
    await this.save(workspacePath, setId, result.doc);
    if (result.removed.feature) await this.syncFeature(workspacePath, setId, result.doc, result.removed.feature);
    return result;
  }

  async restore(workspacePath: string, setId: string, requirement: Requirement, index: number): Promise<RequirementsDoc> {
    const doc = await this.save(workspacePath, setId, restoreRequirement(await this.load(workspacePath, setId), requirement, index));
    if (requirement.feature) await this.syncFeature(workspacePath, setId, doc, requirement.feature);
    return doc;
  }

  async reorder(workspacePath: string, setId: string, ids: string[]): Promise<RequirementsDoc> {
    return this.save(workspacePath, setId, reorderRequirements(await this.load(workspacePath, setId), ids));
  }

  // The requirements of one feature, as a standalone doc for specs/<feature>/requirements.md.
  featureDoc(doc: RequirementsDoc, setId: string, feature: string, title?: string): RequirementsDoc {
    return {
      meta: { ...doc.meta, title: title ?? doc.meta.title, setId },
      requirements: doc.requirements.filter(r => r.feature === feature),
    };
  }

  async writeFeatureCopy(workspacePath: string, setId: string, doc: RequirementsDoc, feature: string, title?: string): Promise<void> {
    if (!isSafeName(feature)) throw new RequirementError(`Invalid feature name: ${feature}`);
    const copy = this.featureDoc(doc, setId, feature, title);
    // Keep the existing title of the copy (the feature's title) when re-syncing.
    if (!title) {
      const current = await this.workspaceRepo.readFile(workspacePath, featureRequirementsPath(feature));
      if (current.trim()) copy.meta.title = parseRequirements(current).meta.title ?? copy.meta.title;
    }
    await this.workspaceRepo.writeFile(workspacePath, featureRequirementsPath(feature), serializeRequirements(copy));
  }

  // Refreshes a feature's copy of its requirements and flags its spec out of date.
  private async syncFeature(workspacePath: string, setId: string, doc: RequirementsDoc, feature: string): Promise<void> {
    if (!isSafeName(feature)) return;
    await this.writeFeatureCopy(workspacePath, setId, doc, feature);
    await this.onLinkedFeatureChanged?.(workspacePath, feature);
  }
}
