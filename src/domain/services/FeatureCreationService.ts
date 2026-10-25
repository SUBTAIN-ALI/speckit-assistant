import { AgentConfig, WorkflowState } from '../models/types';
import { RequirementsDoc, isSafeName } from '../models/requirements';
import { WorkflowUseCases } from '../ports/in/WorkflowUseCases';
import { LlmError } from '../ports/out/LlmPort';
import { WorkspaceRepositoryPort } from '../ports/out/WorkspaceRepositoryPort';
import {
  FeatureGroup,
  GROUPING_SCHEMA,
  GROUPING_SCHEMA_NAME,
  GROUPING_SYSTEM_PROMPT,
  featureDirName,
  groupingUserMessage,
  normalizeGrouping,
  validateGroups,
} from './featureGrouping';
import { IntegrationsService, NotConfiguredError } from './IntegrationsService';
import { RequirementsService } from './RequirementsService';
import { RequirementError, updateRequirement } from './requirementsOps';
import { buildSpecPrompt } from './specPrompt';

// Requirements → Spec Kit features. For each reviewed group:
//   create specs/NNN-name/ → link its requirements → commit a copy of them in
//   the feature → run the existing Specify phase (the agent CLI runs
//   /speckit.specify with the requirements as context, Spec Kit writes spec.md).
// From there the regular SDD flow (clarify → plan → tasks → implement) applies.

type FeatureWorkflow = Pick<WorkflowUseCases, 'getWorkflowState' | 'createFeature' | 'runPhase'>;

export type FeatureEvent =
  | { type: 'start'; index: number; total: number; feature: string; title: string }
  | { type: 'log'; feature: string; text: string }
  | { type: 'done'; feature: string; ok: boolean; message: string };

export type GroupingResult = { groups: FeatureGroup[]; unassigned: string[] };

export class FeatureCreationError extends Error {}

export const SPEC_KIT_MISSING =
  'Spec Kit isn’t initialized in this workspace (.specify/templates is missing), so no spec can be written. ' +
  'Run `specify init --here --ai <your agent>` in the project folder (or install it from Extensions), and make sure the app is pointed at that project (WORKSPACE_PATH). Nothing was created.';

export class FeatureCreationService {
  constructor(
    private workspaceRepo: WorkspaceRepositoryPort,
    private requirements: RequirementsService,
    private integrations: IntegrationsService,
    private workflow: FeatureWorkflow
  ) {}

  private async load(workspacePath: string, setId: string): Promise<RequirementsDoc> {
    const doc = await this.requirements.get(workspacePath, setId);
    if (!doc) throw new FeatureCreationError(`Requirement set not found: ${setId}`);
    return doc;
  }

  // Asks the configured LLM how to split the given requirements into features.
  async proposeGrouping(workspacePath: string, setId: string, requirementIds: string[]): Promise<GroupingResult> {
    const doc = await this.load(workspacePath, setId);
    const selected = doc.requirements.filter(r => requirementIds.includes(r.id) && !r.feature);
    if (selected.length === 0) throw new FeatureCreationError('Select at least one requirement that isn’t already in a feature.');

    let llm;
    try {
      llm = await this.integrations.resolveLlm();
    } catch (err) {
      if (err instanceof NotConfiguredError) throw new FeatureCreationError(err.message);
      throw err;
    }
    let res;
    try {
      res = await llm.client.completeJson({
        system: GROUPING_SYSTEM_PROMPT,
        user: groupingUserMessage(doc, selected),
        schemaName: GROUPING_SCHEMA_NAME,
        schema: GROUPING_SCHEMA as unknown as Record<string, unknown>,
      });
    } catch (err) {
      throw new FeatureCreationError(err instanceof LlmError ? `Couldn’t get a suggestion from ${llm.model}: ${err.message}` : String(err));
    }
    const result = normalizeGrouping(res.json, selected.map(r => r.id));
    if (result.groups.length === 0) throw new FeatureCreationError('The model didn’t return a usable grouping. Try again, or put everything in one feature.');
    return result;
  }

  // Whether Spec Kit has been initialized in the workspace (`specify init`).
  async specKitReady(workspacePath: string): Promise<boolean> {
    const dirs = await this.workspaceRepo.listDirectories(workspacePath, '.specify');
    return dirs.includes('templates') || dirs.includes('scripts');
  }

  // Creates one feature per group, sequentially (each runs an agent CLI).
  async createFeatures(
    workspacePath: string,
    setId: string,
    groups: unknown,
    agentConfig: AgentConfig,
    onEvent: (e: FeatureEvent) => void
  ): Promise<{ created: string[]; failed: string[]; state?: WorkflowState }> {
    const doc = await this.load(workspacePath, setId);
    const valid = validateGroups(groups, doc);
    if (!valid.ok) throw new FeatureCreationError(valid.error);

    // Without Spec Kit the Specify phase is certain to fail; don't leave half-made features behind.
    if (!(await this.specKitReady(workspacePath))) throw new FeatureCreationError(SPEC_KIT_MISSING);

    const created: string[] = [];
    const failed: string[] = [];
    let state: WorkflowState | undefined;
    for (let i = 0; i < valid.groups.length; i++) {
      const group = valid.groups[i];
      const existing = (await this.workflow.getWorkflowState(workspacePath)).features.map(f => f.name);
      const feature = featureDirName(group.name, existing);
      onEvent({ type: 'start', index: i, total: valid.groups.length, feature, title: group.title });

      try {
        // 1. Feature directory, then link its requirements and commit a copy.
        await this.workflow.createFeature(workspacePath, feature);
        let current = await this.load(workspacePath, setId);
        for (const id of group.requirementIds) current = updateRequirement(current, id, { feature });
        await this.requirements.save(workspacePath, setId, current);
        await this.requirements.writeFeatureCopy(workspacePath, setId, current, feature, group.title);
        onEvent({ type: 'log', feature, text: `Created specs/${feature}/ with ${group.requirementIds.length} requirement(s).\n` });

        // 2. Spec Kit writes spec.md.
        state = await this.runSpecify(workspacePath, current, setId, feature, group, agentConfig, t => onEvent({ type: 'log', feature, text: t }));
        const ok = this.specWritten(state, feature);
        (ok ? created : failed).push(feature);
        onEvent({
          type: 'done', feature, ok,
          message: ok
            ? `spec.md is ready for review in ${feature}.`
            : `The agent finished without writing specs/${feature}/spec.md. Check the log, then use “Generate spec” to retry.`,
        });
      } catch (err) {
        failed.push(feature);
        onEvent({ type: 'done', feature, ok: false, message: err instanceof Error ? err.message : String(err) });
      }
    }
    return { created, failed, state };
  }

  // Re-runs spec generation for a feature already created from this set.
  async generateSpec(
    workspacePath: string,
    setId: string,
    feature: string,
    agentConfig: AgentConfig,
    onLog: (text: string) => void
  ): Promise<{ ok: boolean; state: WorkflowState }> {
    if (!isSafeName(feature)) throw new RequirementError(`Invalid feature name: ${feature}`);
    if (!(await this.specKitReady(workspacePath))) throw new FeatureCreationError(SPEC_KIT_MISSING);
    const doc = await this.load(workspacePath, setId);
    const ids = doc.requirements.filter(r => r.feature === feature).map(r => r.id);
    if (ids.length === 0) throw new FeatureCreationError(`No requirements in this set are linked to ${feature}.`);
    const state = await this.runSpecify(workspacePath, doc, setId, feature, { name: feature, title: feature, requirementIds: ids }, agentConfig, onLog);
    return { ok: this.specWritten(state, feature), state };
  }

  private async runSpecify(
    workspacePath: string,
    doc: RequirementsDoc,
    setId: string,
    feature: string,
    group: FeatureGroup,
    agentConfig: AgentConfig,
    onLog: (text: string) => void
  ): Promise<WorkflowState> {
    const copy = this.requirements.featureDoc(doc, setId, feature);
    const prompt = buildSpecPrompt({
      feature,
      title: group.title,
      summary: group.summary,
      meta: doc.meta,
      requirements: copy.requirements,
    });
    return this.workflow.runPhase(workspacePath, 'specification', feature, agentConfig, prompt, onLog);
  }

  private specWritten(state: WorkflowState, feature: string): boolean {
    const spec = state.features.find(f => f.name === feature)?.phases.find(p => p.phase === 'specification');
    return !!spec?.filePath && spec.status !== 'idle';
  }
}
