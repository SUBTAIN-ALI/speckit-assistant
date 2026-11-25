import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EpsService } from './EpsService';
import { EpsError, EpsMessage, EpsRequirement, EpsState, emptyEpsState } from '../models/eps';
import { EpsGatewayPort, EpsStorePort } from '../ports/out/EpsPort';
import { RequirementsService } from './RequirementsService';
import { MemoryWorkspace } from '../../test/meetingFakes';
import { WorkflowState } from '../models/types';

const ID = '12345678-1234-4321-8765-123456789abc';
const NOW = Date.parse('2026-11-18T12:00:00Z');
const initial: EpsRequirement = { id: ID, title: 'Order export', businessOutcome: 'Export orders', acceptanceCriteria: ['CSV download'], stage: 'plan_review', released: true, updatedAt: '2026-11-18T10:00:00Z' };
class Store implements EpsStorePort {
  states = new Map<string, EpsState>();
  async load(ws: string) { return structuredClone(this.states.get(ws) ?? emptyEpsState()); }
  async save(ws: string, state: EpsState) { this.states.set(ws, structuredClone(state)); }
  async exclusive<T>(_ws: string, action: () => Promise<T>) { return action(); }
}
describe('EPS synchronization', () => {
  let store: Store, workspace: MemoryWorkspace, requirements: RequirementsService, service: EpsService;
  let remote: EpsRequirement, messages: EpsMessage[], gateway: EpsGatewayPort;
  let workflow: WorkflowState;
  beforeEach(() => {
    store = new Store(); workspace = new MemoryWorkspace(); requirements = new RequirementsService(workspace);
    workflow = { constitutionPhase: { phase: 'constitution', status: 'approved', filePath: null, content: null }, activeFeatureName: null, features: [] };
    workspace.getWorkflowState = vi.fn(async () => workflow);
    remote = structuredClone(initial); messages = [];
    gateway = {
      test: vi.fn(async () => {}),
      call: vi.fn(async (_env, tool, args) => {
        if (tool === 'list_released_requirements') return remote.released ? [structuredClone(remote)] : [];
        if (tool === 'get_requirement') return structuredClone(remote);
        if (tool === 'get_messages') return structuredClone(messages);
        if (tool === 'update_status') {
          if (args.stage) remote.stage = args.stage as EpsRequirement['stage'];
          if (args.velocity) remote.velocity = args.velocity as string;
          if (args.manifest) remote.sdlcManifest = args.manifest as Record<string, unknown>;
        }
        if (tool === 'post_message') messages.push({ id: `m${messages.length}`, requirementId: ID, author: 'dev', type: args.type as 'question', body: String(args.body), createdAt: new Date(NOW).toISOString() });
        return {};
      }),
    };
    service = new EpsService(store, { get: async () => 'eps_mcp_test', set: vi.fn(async () => {}) }, gateway, requirements, workspace, () => NOW);
  });
  const importOne = async () => service.importRequirement('/project', ID);
  const link = async (setId: string) => {
    await requirements.update('/project', setId, 'REQ-001', { feature: '001-export' });
    workflow.features = [{ name: '001-export', phases: [{ phase: 'implementation', status: 'running', filePath: null, content: null }] }];
  };

  it('imports once with stable UUID mapping and leaves existing lists unchanged', async () => {
    const unrelated = await requirements.create('/project', 'Existing');
    const before = await requirements.get('/project', unrelated.id);
    const id = await importOne();
    expect(await importOne()).toBe(id);
    expect((await service.view('/project')).bindings).toHaveLength(1);
    expect((await requirements.get('/project', id))?.requirements[0]).toMatchObject({ id: 'REQ-001', description: 'Export orders', acceptanceCriteria: ['CSV download'], status: 'accepted' });
    expect(await requirements.get('/project', unrelated.id)).toEqual(before);
    expect((await service.view('/other-project')).bindings).toHaveLength(0);
  });
  it('rejects unreleased requirements and environment switches after linking', async () => {
    remote.released = false;
    await expect(importOne()).rejects.toThrow(/released/);
    remote.released = true; await importOne();
    await expect(service.configure('/project', { environment: 'production' })).rejects.toThrow(/separate workspace/);
  });
  it('keeps Markdown headings in business content from creating phantom local requirements', async () => {
    remote.businessOutcome = 'Export orders\n\n## Business detail\nKeep currency\n\n**Acceptance criteria**\nInclude totals';
    const set = await importOne();
    const doc = await requirements.get('/project', set);
    expect(doc?.requirements).toHaveLength(1);
    expect(doc?.requirements[0].description).toContain('Business detail');
    expect(doc?.requirements[0].acceptanceCriteria).toEqual(['CSV download']);
    expect(doc?.requirements[0].source?.quote).toBe(`staging:${ID}`);
  });
  it('recovers a partially completed import without duplicating local files', async () => {
    const id = await importOne();
    await store.save('/project', emptyEpsState());
    expect(await importOne()).toBe(id);
    expect((await requirements.get('/project', id))?.requirements).toHaveLength(1);
  });
  it('refreshes clean content and preserves conflicting local edits', async () => {
    const set = await importOne();
    remote.businessOutcome = 'Updated by owner';
    await service.sync('/project');
    expect((await requirements.get('/project', set))?.requirements[0].description).toBe('Updated by owner');
    await requirements.update('/project', set, 'REQ-001', { description: 'Local proposal' });
    remote.businessOutcome = 'Another owner edit';
    const state = await service.sync('/project');
    expect(state.bindings[0].conflict).toContain('local');
    expect((await requirements.get('/project', set))?.requirements[0].description).toBe('Local proposal');
    await service.resolveConflict('/project', ID);
    expect((await requirements.get('/project', set))?.requirements[0].description).toBe('Another owner edit');
  });
  it('reports task evidence automatically, preserves manifests, and deduplicates reports', async () => {
    const set = await importOne(); await link(set);
    remote.sdlcManifest = { pr: 'https://example.test/pr/1' };
    workspace.files.set('specs/001-export/tasks.md', '- [x] T001 First\n- [ ] T002 Second');
    await service.sync('/project');
    expect(remote).toMatchObject({ stage: 'ai_dev', velocity: '50% (1/2 tasks)', sdlcManifest: { pr: 'https://example.test/pr/1', specRabbit: { feature: '001-export' } } });
    const count = () => vi.mocked(gateway.call).mock.calls.filter(c => c[1] === 'update_status').length;
    const first = count(); await service.sync('/project'); expect(count()).toBe(first);
    expect(vi.mocked(gateway.call).mock.calls.some(c => c[1] === 'set_compliance')).toBe(false);
    workflow.features[0].phases[0].status = 'approved';
    await service.sync('/project'); expect(remote.stage).toBe('uat');
    expect(remote.stage).not.toBe('prod');
  });
  it('does not mark failed or stale implementations ready for UAT', async () => {
    const set = await importOne(); await link(set);
    workflow.features[0].phases[0].status = 'approved'; workflow.features[0].phases[0].stale = true;
    await service.sync('/project'); expect(remote.stage).toBe('ai_dev');
  });
  it('pauses linked work for questions and applies an owner answer exactly once', async () => {
    const set = await importOne(); await link(set);
    await expect(service.postMessage('/project', ID, 'question', 'Which format?')).rejects.toThrow(/current feature run/);
    workflow.features[0].phases[0].status = 'idle';
    await service.postMessage('/project', ID, 'question', 'Which format?');
    await expect(service.assertReady('/project', '001-export')).rejects.toThrow(/paused/);
    await expect(service.assertReady('/project', '002-other')).resolves.toBeUndefined();
    await service.sync('/project');
    messages.push({ id: 'answer', requirementId: ID, author: 'business', type: 'answer', body: 'Use CSV.', createdAt: new Date(NOW + 1000).toISOString() });
    await service.sync('/project'); await service.sync('/project');
    expect((await service.view('/project')).bindings[0].messages).toHaveLength(2);
    await service.applyAnswer('/project', ID, 'answer'); await service.applyAnswer('/project', ID, 'answer');
    expect((await requirements.get('/project', set))?.requirements[0].description.match(/Use CSV/g)).toHaveLength(1);
    await expect(service.assertReady('/project', '001-export')).resolves.toBeUndefined();
    expect(vi.mocked(gateway.call).mock.calls.find(c => c[1] === 'get_messages' && c[2].since)?.[2].since).toBe(new Date(NOW - 1000).toISOString());
  });
  it('never retries an uncertain message, including after service restart', async () => {
    await importOne(); await service.postMessage('/project', ID, 'update', 'Work started');
    const original = gateway.call;
    gateway.call = vi.fn(async (env, tool, args) => { if (tool === 'post_message') throw new EpsError('Lost response', 'transport'); return original(env, tool, args); });
    await service.sync('/project'); await service.sync('/project');
    const state = await service.view('/project');
    expect(state.outbox[0].state).toBe('uncertain');
    expect(vi.mocked(gateway.call).mock.calls.filter(c => c[1] === 'post_message')).toHaveLength(1);
    await expect(service.resolveWrite('/project', state.outbox[0].id, 'retry')).rejects.toThrow(/cannot be retried/);
  });
  it('recovers in-flight messages as uncertain without sending again', async () => {
    await importOne(); await service.postMessage('/project', ID, 'update', 'Hello');
    const state = await store.load('/project'); state.outbox[0].state = 'sending'; await store.save('/project', state);
    await service.sync('/project');
    expect((await service.view('/project')).outbox[0].state).toBe('uncertain');
    expect(vi.mocked(gateway.call).mock.calls.some(c => c[1] === 'post_message')).toBe(false);
  });
  it('backs off repeatable writes and retries after the delay', async () => {
    await importOne(); await service.report('/project', ID, { stage: 'ai_dev', evidence: 'PR #1' });
    const original = gateway.call;
    gateway.call = vi.fn(async (env, tool, args) => { if (tool === 'update_status') throw new EpsError('Network failure', 'transport'); return original(env, tool, args); });
    await service.sync('/project'); await service.sync('/project');
    expect(vi.mocked(gateway.call).mock.calls.filter(c => c[1] === 'update_status')).toHaveLength(1);
    const state = await store.load('/project'); state.outbox[0].nextAttempt = 0; await store.save('/project', state);
    gateway.call = original; await service.sync('/project'); expect((await service.view('/project')).outbox).toHaveLength(0);
  });
  it('does not send a queued readiness report after detecting an owner/local conflict', async () => {
    const set = await importOne();
    await service.report('/project', ID, { stage: 'uat', evidence: 'Tests passed' });
    await requirements.update('/project', set, 'REQ-001', { description: 'Local decision' });
    remote.businessOutcome = 'Changed scope';
    await service.sync('/project');
    expect(vi.mocked(gateway.call).mock.calls.some(c => c[1] === 'update_status')).toBe(false);
    expect((await service.view('/project')).outbox).toHaveLength(1);
  });
  it('stops polling rejected credentials until a replacement is saved', async () => {
    gateway.call = vi.fn(async () => { throw new EpsError('Replace token', 'auth'); });
    expect((await service.sync('/project')).authBlocked).toBe(true);
    await service.sync('/project'); expect(gateway.call).toHaveBeenCalledTimes(1);
    await service.configure('/project', { token: 'eps_mcp_replacement' });
    await service.sync('/project'); expect(gateway.call).toHaveBeenCalledTimes(2);
  });
  it('pauses unavailable requirements and retains their mapping', async () => {
    const set = await importOne(); await link(set);
    await service.sync('/project'); remote.released = false;
    const state = await service.sync('/project'); expect(state.bindings[0].unavailable).toBe(true);
    await expect(service.assertReady('/project', '001-export')).rejects.toThrow(/paused/);
    await expect(service.postMessage('/project', ID, 'update', 'Hello')).rejects.toThrow(/no longer available/);
  });
  it('requires evidence and validates compliance without queuing partial reports', async () => {
    await importOne();
    await expect(service.report('/project', ID, { checks: { soc2: true } })).rejects.toThrow(/evidence/);
    await expect(service.report('/project', ID, { stage: 'prod', checks: { soc2: 'yes' }, evidence: 'Audited' })).rejects.toThrow(/boolean/);
    expect((await service.view('/project')).outbox).toHaveLength(0);
    await service.report('/project', ID, { checks: { docs: true }, evidence: 'Reviewed docs' });
    const state = await service.view('/project'); expect(state.outbox.map(o => o.tool)).toEqual(['update_status', 'set_compliance']);
    expect(state.outbox[0].args.manifest).toMatchObject({ evidence: 'Reviewed docs' });
  });
});
