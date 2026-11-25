import { randomUUID } from 'crypto';
import { EPS_CHECKS, EPS_STAGES, EpsBinding, EpsEnvironment, EpsError, EpsMessage, EpsRequirement, EpsStage, EpsState, EpsWrite } from '../models/eps';
import { EpsGatewayPort, EpsSecretsPort, EpsStorePort } from '../ports/out/EpsPort';
import { WorkspaceRepositoryPort } from '../ports/out/WorkspaceRepositoryPort';
import { RequirementsService } from './RequirementsService';
import { emptyRequirementsDoc } from './requirementsMarkdown';
import { appendRequirements } from './requirementsOps';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Reserve the delimiters used by the existing requirements.md parser. Business
// prose must not accidentally turn into additional local requirements.
const safeDescription = (text: string) => text.replace(/\r\n/g, '\n').trim()
  .replace(/^##(?=\s)/gm, '###').replace(/^\*\*Acceptance criteria\*\*\s*$/gmi, '**Business acceptance criteria**');
const content = (r: EpsRequirement) => ({
  title: r.title.replace(/\s*\n\s*/g, ' ').trim(), description: safeDescription(r.businessOutcome),
  acceptanceCriteria: r.acceptanceCriteria.map(a => a.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean),
});
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const errorMessage = (e: unknown) => e instanceof EpsError ? e.message : 'EPS synchronization failed. Check the connection and local project files.';

export function parseEpsRequirement(value: unknown): EpsRequirement {
  const r = value as EpsRequirement;
  if (!r || !UUID.test(r.id) || typeof r.title !== 'string' || !r.title.trim() || typeof r.businessOutcome !== 'string'
    || !Array.isArray(r.acceptanceCriteria) || r.acceptanceCriteria.some(a => typeof a !== 'string')
    || !EPS_STAGES.includes(r.stage) || typeof r.released !== 'boolean' || !Number.isFinite(Date.parse(r.updatedAt))) {
    throw new EpsError('EPS returned an invalid requirement.', 'protocol');
  }
  return r;
}

export class EpsService {
  constructor(
    private store: EpsStorePort, private secrets: EpsSecretsPort, private gateway: EpsGatewayPort,
    private requirements: RequirementsService, private workspace: WorkspaceRepositoryPort,
    private now: () => number = Date.now,
  ) {}

  async view(ws: string) {
    const state = await this.store.load(ws);
    return { ...state, configured: !!await this.secrets.get(state.environment) };
  }
  async configure(ws: string, input: { environment?: unknown; enabled?: unknown; token?: unknown }) {
    return this.store.exclusive(ws, async () => {
      const state = await this.store.load(ws);
      if (input.environment !== undefined && input.environment !== 'staging' && input.environment !== 'production') throw new EpsError('Choose staging or production.');
      if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw new EpsError('Invalid synchronization setting.');
      const environment = (input.environment ?? state.environment) as EpsEnvironment;
      if (environment !== state.environment && (state.bindings.length || state.outbox.length)) throw new EpsError('This workspace is linked to EPS requirements. Use a separate workspace for another EPS environment.');
      if (input.token !== undefined) {
        if (typeof input.token !== 'string' || !/^eps_mcp_[A-Za-z0-9_-]+$/.test(input.token.trim())) throw new EpsError('Enter a valid EPS machine token.');
        await this.secrets.set(environment, input.token.trim());
        // An explicitly replaced token allows failed writes to be retried, except uncertain messages.
        for (const item of state.outbox) if (item.state === 'failed' && item.error?.includes('token')) { item.state = 'pending'; item.nextAttempt = 0; }
      }
      state.environment = environment;
      state.enabled = (input.enabled ?? state.enabled) as boolean;
      if (input.token !== undefined) state.authBlocked = false;
      delete state.error;
      await this.store.save(ws, state);
      return this.view(ws);
    });
  }
  async test(ws: string) { await this.gateway.test((await this.store.load(ws)).environment); }
  async discover(ws: string): Promise<EpsRequirement[]> {
    const state = await this.store.load(ws);
    return this.released(state.environment);
  }
  private async released(environment: EpsEnvironment) {
    const result = await this.gateway.call(environment, 'list_released_requirements', {});
    if (!Array.isArray(result)) throw new EpsError('EPS returned an invalid requirement list.', 'protocol');
    return result.map(parseEpsRequirement).filter(r => r.released);
  }
  private binding(state: EpsState, id: string) {
    const binding = state.bindings.find(b => b.requirement.id === id);
    if (!binding) throw new EpsError('Import this EPS requirement into the current project first.');
    return binding;
  }
  private enqueue(state: EpsState, binding: EpsBinding, tool: EpsWrite['tool'], args: Record<string, unknown>) {
    if (binding.unavailable) throw new EpsError('This requirement is no longer available in the released list.');
    const item: EpsWrite = {
      id: randomUUID(), requirementId: binding.requirement.id, tool,
      args: { ...args, requirement_id: binding.requirement.id }, state: 'pending', attempts: 0, nextAttempt: 0,
    };
    state.outbox.push(item);
    return item;
  }
  async importRequirement(ws: string, id: string) {
    if (!UUID.test(id)) throw new EpsError('Invalid EPS requirement ID.');
    return this.store.exclusive(ws, async () => {
      const state = await this.store.load(ws);
      const existing = state.bindings.find(b => b.requirement.id === id);
      if (existing) return existing.setId;
      const requirement = parseEpsRequirement(await this.gateway.call(state.environment, 'get_requirement', { requirement_id: id }));
      if (requirement.id !== id || !requirement.released) throw new EpsError('Only the selected released requirement can be imported.');
      // Deterministic path makes import recoverable if interrupted between file and state writes.
      const setId = `eps-${state.environment}-${id.toLowerCase()}`;
      let doc = await this.requirements.get(ws, setId);
      if (!doc) {
        doc = appendRequirements(emptyRequirementsDoc({ title: `EPS · ${requirement.title}`, source: 'manual' }), [
          { ...content(requirement), status: 'accepted', priority: 'must', source: { speaker: 'EPS', quote: `${state.environment}:${id}` } },
        ]);
        await this.requirements.save(ws, setId, doc);
      }
      if (!doc.requirements[0]) throw new EpsError('The imported requirement list is empty. Restore it before linking EPS.');
      state.bindings.push({ requirement, setId, localId: doc.requirements[0].id, messages: [], appliedAnswers: [] });
      await this.store.save(ws, state);
      return setId;
    });
  }

  async postMessage(ws: string, id: string, type: unknown, body: unknown) {
    if ((type !== 'update' && type !== 'question') || typeof body !== 'string' || !body.trim() || body.length > 5000) throw new EpsError('Enter an update or question of at most 5,000 characters.');
    await this.store.exclusive(ws, async () => {
      const state = await this.store.load(ws);
      const binding = this.binding(state, id);
      if (type === 'question' && binding.waitingForAnswer) throw new EpsError('Resolve the outstanding question before posting another.');
      const local = (await this.requirements.get(ws, binding.setId))?.requirements.find(r => r.id === binding.localId);
      if (local?.feature) {
        binding.feature = local.feature;
        if (type === 'question') {
          const feature = (await this.workspace.getWorkflowState(ws)).features.find(f => f.name === local.feature);
          if (feature?.phases.some(p => p.status === 'running')) throw new EpsError('Stop or finish the current feature run before asking the owner a blocking question.');
        }
      }
      this.enqueue(state, binding, 'post_message', { type, body: body.trim() });
      if (type === 'question') binding.waitingForAnswer = true;
      await this.store.save(ws, state);
    });
  }
  async report(ws: string, id: string, input: { stage?: unknown; velocity?: unknown; manifest?: unknown; checks?: unknown; evidence?: unknown }) {
    await this.store.exclusive(ws, async () => {
      const state = await this.store.load(ws);
      const binding = this.binding(state, id);
      if (input.stage !== undefined && !EPS_STAGES.includes(input.stage as EpsStage)) throw new EpsError('Invalid EPS stage.');
      if (input.velocity !== undefined && (typeof input.velocity !== 'string' || input.velocity.length > 100)) throw new EpsError('Progress must be a short label.');
      if (input.manifest !== undefined && (!input.manifest || typeof input.manifest !== 'object' || Array.isArray(input.manifest))) throw new EpsError('Manifest must be a JSON object.');
      const evidence = typeof input.evidence === 'string' ? input.evidence.trim() : '';
      if (!evidence || evidence.length > 5000) throw new EpsError('Provide evidence for this report (at most 5,000 characters).');
      if (binding.waitingForAnswer || binding.conflict) throw new EpsError('Resolve the requirement’s pending question or content conflict before reporting readiness.');
      const manifest = { ...binding.requirement.sdlcManifest, ...(input.manifest as object ?? {}), evidence };
      if (input.stage !== undefined || input.velocity !== undefined || input.manifest !== undefined) {
        this.enqueue(state, binding, 'update_status', { ...(input.stage ? { stage: input.stage } : {}), ...(input.velocity !== undefined ? { velocity: input.velocity } : {}), manifest });
      }
      if (input.checks !== undefined) {
        if (!input.checks || typeof input.checks !== 'object' || Array.isArray(input.checks)
          || Object.entries(input.checks).some(([key, value]) => !EPS_CHECKS.includes(key as typeof EPS_CHECKS[number]) || typeof value !== 'boolean')) throw new EpsError('Compliance checks must use the supported boolean flags.');
        // Store evidence before publishing compliance. Both operations are repeatable.
        if (input.stage === undefined && input.velocity === undefined && input.manifest === undefined) this.enqueue(state, binding, 'update_status', { manifest });
        this.enqueue(state, binding, 'set_compliance', { checks: input.checks });
      }
      await this.store.save(ws, state);
    });
  }
  async applyAnswer(ws: string, id: string, messageId: string) {
    await this.store.exclusive(ws, async () => {
      const state = await this.store.load(ws);
      const b = this.binding(state, id);
      const answer = b.messages.find(m => m.id === messageId && m.author === 'business' && m.type === 'answer');
      if (!answer) throw new EpsError('Select an answer from the business owner.');
      if (b.appliedAnswers.includes(answer.id)) return;
      const outstandingQuestion = state.outbox.some(o => o.requirementId === id && o.tool === 'post_message' && o.args.type === 'question');
      if (outstandingQuestion) throw new EpsError('Resolve the queued question delivery before applying an answer.');
      const latestQuestion = b.messages.filter(m => m.type === 'question' && m.author === 'dev').at(-1);
      if (b.waitingForAnswer && (!latestQuestion || Date.parse(answer.createdAt) < Date.parse(latestQuestion.createdAt))) throw new EpsError('This answer predates the outstanding question.');
      const doc = await this.requirements.get(ws, b.setId);
      const local = doc?.requirements.find(r => r.id === b.localId);
      if (!local) throw new EpsError('The linked local requirement is missing.');
      const marker = `<!-- eps-answer:${answer.id} -->`;
      if (!local.description.includes(marker)) await this.requirements.update(ws, b.setId, b.localId, {
        description: `${local.description}\n\n${marker}\nBusiness clarification (${answer.createdAt}):\n${safeDescription(answer.body)}`,
      });
      b.appliedAnswers.push(answer.id);
      b.waitingForAnswer = false;
      await this.store.save(ws, state);
    });
  }
  async resolveConflict(ws: string, id: string) {
    await this.store.exclusive(ws, async () => {
      const state = await this.store.load(ws);
      const b = this.binding(state, id);
      await this.requirements.update(ws, b.setId, b.localId, content(b.requirement));
      delete b.conflict;
      b.appliedAnswers = [];
      await this.store.save(ws, state);
    });
  }
  async resolveWrite(ws: string, id: string, action: unknown) {
    await this.store.exclusive(ws, async () => {
      const state = await this.store.load(ws);
      const item = state.outbox.find(o => o.id === id);
      if (!item || (action !== 'retry' && action !== 'discard')) throw new EpsError('Invalid queued action.');
      if (item.state === 'uncertain' && action === 'retry') throw new EpsError('An uncertain message cannot be retried automatically. Check the conversation, discard it, and compose a new message if needed.');
      if (action === 'discard') {
        state.outbox = state.outbox.filter(o => o.id !== id);
        this.binding(state, item.requirementId).lastReport = undefined;
        if (item.tool === 'post_message' && item.args.type === 'question') this.binding(state, item.requirementId).waitingForAnswer = false;
      } else { item.state = 'pending'; item.nextAttempt = 0; delete item.error; }
      await this.store.save(ws, state);
    });
  }
  async assertReady(ws: string, feature: string | null) {
    if (!feature) return;
    const state = await this.store.load(ws);
    for (const binding of state.bindings) {
      const local = (await this.requirements.get(ws, binding.setId))?.requirements.find(r => r.id === binding.localId);
      if ((local?.feature ?? binding.feature) === feature && (binding.waitingForAnswer || binding.conflict || binding.unavailable)) {
        throw new EpsError('This feature is paused in EPS. Resolve the owner question, content conflict, or requirement availability in Requirements → EPS.');
      }
    }
  }

  private async flush(ws: string, state: EpsState, messagesOnly = false) {
    // A process may have stopped after sending, before recording the response.
    for (const item of state.outbox) if (item.state === 'sending') item.state = item.tool === 'post_message' ? 'uncertain' : 'pending';
    for (const item of [...state.outbox]) {
      const b = this.binding(state, item.requirementId);
      if (b.unavailable || item.state !== 'pending' || item.nextAttempt > this.now()) continue;
      if (item.tool !== 'post_message' && (messagesOnly || b.conflict || b.waitingForAnswer)) continue;
      // Preserve report ordering (evidence before flags) and conversation ordering
      // independently, so a blocked status cannot prevent a clarification question.
      if (state.outbox.some(o => o.requirementId === item.requirementId && (o.tool === 'post_message') === (item.tool === 'post_message') && state.outbox.indexOf(o) < state.outbox.indexOf(item))) continue;
      item.state = 'sending'; item.attempts++;
      await this.store.save(ws, state);
      try {
        await this.gateway.call(state.environment, item.tool, item.args);
        state.outbox = state.outbox.filter(o => o.id !== item.id);
      } catch (error) {
        item.error = errorMessage(error);
        if (error instanceof EpsError && (error.kind === 'auth' || error.kind === 'tool' || (error.kind === 'protocol' && item.tool !== 'post_message'))) item.state = 'failed';
        else if (item.tool === 'post_message') item.state = 'uncertain';
        else { item.state = 'pending'; item.nextAttempt = this.now() + Math.min(30 * 60_000, 60_000 * 2 ** Math.min(item.attempts, 5)); }
        if (error instanceof EpsError && error.kind === 'auth') { state.error = item.error; await this.store.save(ws, state); throw error; }
      }
      await this.store.save(ws, state);
    }
  }
  async sync(ws: string) {
    return this.store.exclusive(ws, async () => {
      const state = await this.store.load(ws);
      if (state.authBlocked) return this.view(ws);
      try {
        const released = await this.released(state.environment);
        for (const b of state.bindings) b.unavailable = !released.some(r => r.id === b.requirement.id);
        await this.store.save(ws, state);
        await this.flush(ws, state, true);
        for (const b of state.bindings) {
          if (b.unavailable) continue;
          const remote = parseEpsRequirement(await this.gateway.call(state.environment, 'get_requirement', { requirement_id: b.requirement.id }));
          if (remote.id !== b.requirement.id) throw new EpsError('EPS returned a different requirement.', 'protocol');
          if (!remote.released) { b.unavailable = true; continue; }
          const doc = await this.requirements.get(ws, b.setId);
          const local = doc?.requirements.find(r => r.id === b.localId);
          if (!local) b.conflict = 'The local requirement was removed. Restore its list and requirement to continue.';
          else if (!same(content(remote), content(b.requirement))) {
            const localContent = { title: local.title, description: local.description, acceptanceCriteria: local.acceptanceCriteria };
            if (same(localContent, content(b.requirement)) || same(localContent, content(remote))) {
              await this.requirements.update(ws, b.setId, b.localId, content(remote));
              delete b.conflict;
            } else b.conflict = 'EPS changed while the local requirement also had edits or clarifications. Review both versions before replacing local content.';
          }
          b.requirement = remote;
          const since = b.cursor ? new Date(Date.parse(b.cursor) - 1000).toISOString() : undefined;
          const result = await this.gateway.call(state.environment, 'get_messages', { requirement_id: remote.id, ...(since ? { since } : {}) });
          if (!Array.isArray(result)) throw new EpsError('EPS returned an invalid conversation.', 'protocol');
          for (const raw of result) {
            const m = raw as EpsMessage;
            if (!m || typeof m.id !== 'string' || m.requirementId !== remote.id || typeof m.body !== 'string'
              || !['dev', 'business'].includes(m.author) || !['update', 'question', 'answer'].includes(m.type) || !Number.isFinite(Date.parse(m.createdAt))) throw new EpsError('EPS returned an invalid message.', 'protocol');
            if (!b.messages.some(existing => existing.id === m.id)) b.messages.push(m);
            if (!b.cursor || Date.parse(m.createdAt) > Date.parse(b.cursor)) b.cursor = m.createdAt;
          }
          b.messages.sort((a, c) => Date.parse(a.createdAt) - Date.parse(c.createdAt) || a.id.localeCompare(c.id));
          await this.captureProgress(ws, state, b);
          await this.store.save(ws, state);
        }
        await this.flush(ws, state);
        state.lastSync = new Date(this.now()).toISOString();
        delete state.error;
      } catch (error) {
        state.error = errorMessage(error);
        if (error instanceof EpsError && error.kind === 'auth') state.authBlocked = true;
      }
      await this.store.save(ws, state);
      return this.view(ws);
    });
  }
  private async captureProgress(ws: string, state: EpsState, b: EpsBinding) {
    if (b.conflict || b.waitingForAnswer) return;
    const local = (await this.requirements.get(ws, b.setId))?.requirements.find(r => r.id === b.localId);
    if (!local?.feature) return;
    b.feature = local.feature;
    const workflow = await this.workspace.getWorkflowState(ws);
    const feature = workflow.features.find(f => f.name === local.feature);
    if (!feature) return;
    const impl = feature.phases.find(p => p.phase === 'implementation');
    const ready = impl?.status === 'approved' && !feature.phases.some(p => p.stale || p.status === 'failed') && !impl.personas?.some(p => p.status !== 'passed');
    const started = impl && impl.status !== 'idle';
    const suggested: EpsStage = ready ? 'uat' : started ? 'ai_dev' : 'plan_review';
    const stage = EPS_STAGES.indexOf(b.requirement.stage) > EPS_STAGES.indexOf(suggested) ? b.requirement.stage : suggested;
    const tasks = (await this.workspace.readFile(ws, `specs/${local.feature}/tasks.md`)).match(/^\s*-\s+\[[ xX]\].*$/gm) ?? [];
    const completed = tasks.filter(t => /\[[xX]\]/.test(t)).length;
    const velocity = tasks.length ? `${Math.floor(completed / tasks.length * 100)}% (${completed}/${tasks.length} tasks)` : 'Planning';
    const manifest = {
      ...b.requirement.sdlcManifest,
      specRabbit: { feature: local.feature, requirementId: local.id, phases: feature.phases.map(p => ({ phase: p.phase, status: p.status, stale: !!p.stale })),
        reviews: impl?.personas?.map(p => ({ id: p.id, status: p.status, report: p.reportPath })) ?? [],
        completedTasks: completed, totalTasks: tasks.length },
    };
    const report = JSON.stringify({ stage, velocity, manifest });
    if (b.lastReport === report || state.outbox.some(o => o.requirementId === b.requirement.id && o.tool === 'update_status' && !o.automatic)) return;
    // Offline progress may have changed: replace obsolete automatic snapshots
    // before delivery instead of announcing a stage from an earlier run.
    const previous = state.outbox.find(o => o.requirementId === b.requirement.id && o.automatic);
    state.outbox = state.outbox.filter(o => !(o.requirementId === b.requirement.id && o.automatic));
    const item = this.enqueue(state, b, 'update_status', { stage, velocity, manifest });
    item.automatic = true;
    if (previous) { item.nextAttempt = previous.nextAttempt; item.attempts = previous.attempts; }
    b.lastReport = report;
  }
}
