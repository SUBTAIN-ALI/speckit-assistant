import { describe, it, expect, beforeEach } from 'vitest';
import { FeatureCreationService, FeatureEvent } from './FeatureCreationService';
import { RequirementsService } from './RequirementsService';
import { IntegrationsService } from './IntegrationsService';
import { MemoryCredentials, MemoryWorkspace, ScriptedLlm } from '../../test/meetingFakes';
import { appendRequirements } from './requirementsOps';
import { emptyRequirementsDoc, parseRequirements } from './requirementsMarkdown';
import { WorkflowState, WorkflowPhase, AgentConfig } from '../models/types';
import { LlmError } from '../ports/out/LlmPort';

// A workflow double: features live in memory; runPhase "writes" spec.md unless told to fail.
class FakeWorkflow {
  features: string[] = ['001-existing'];
  runs: Array<{ feature: string; phase: WorkflowPhase; prompt?: string; agent: AgentConfig }> = [];
  failFeatures = new Set<string>();
  constructor(private ws: MemoryWorkspace) {}
  private state(): WorkflowState {
    return {
      constitutionPhase: { phase: 'constitution', status: 'approved', filePath: 'c', content: '' },
      activeFeatureName: null,
      features: this.features.map(name => ({
        name,
        phases: [{ phase: 'specification', status: this.ws.files.has(`specs/${name}/spec.md`) ? 'awaiting_review' : 'idle', filePath: this.ws.files.has(`specs/${name}/spec.md`) ? `specs/${name}/spec.md` : null, content: null }],
      })),
    } as WorkflowState;
  }
  async getWorkflowState() { return this.state(); }
  async createFeature(_ws: string, name: string) { this.features.push(name); return this.state(); }
  async runPhase(_ws: string, phase: WorkflowPhase, feature: string | null, agent: AgentConfig, prompt?: string, onData?: (t: string) => void) {
    this.runs.push({ feature: feature!, phase, prompt, agent });
    onData?.(`agent working on ${feature}\n`);
    if (!this.failFeatures.has(feature!)) this.ws.files.set(`specs/${feature}/spec.md`, '# Spec');
    return this.state();
  }
}

const AGENT: AgentConfig = { agentType: 'openai' };
const SET = '2026-10-20-weekly-sync';

describe('FeatureCreationService', () => {
  let ws: MemoryWorkspace;
  let workflow: FakeWorkflow;
  let llm: ScriptedLlm;
  let reqs: RequirementsService;
  let svc: FeatureCreationService;

  beforeEach(async () => {
    ws = new MemoryWorkspace();
    ws.files.set('.specify/templates/spec-template.md', '# template');
    workflow = new FakeWorkflow(ws);
    llm = new ScriptedLlm('openai', []);
    const creds = new MemoryCredentials({ llm: { provider: 'openai', keys: { openai: 'sk-test-1234' }, models: {} } });
    reqs = new RequirementsService(ws);
    svc = new FeatureCreationService(ws, reqs, new IntegrationsService(creds, () => llm, {}), workflow);
    await reqs.save('/ws', SET, appendRequirements(emptyRequirementsDoc({ title: 'Weekly sync', meetingTopic: 'Weekly sync' }), [
      { title: 'Reset password', status: 'accepted', priority: 'must' },
      { title: 'Lockout', status: 'accepted' },
      { title: 'CSV export', status: 'accepted' },
      { title: 'SSO?', type: 'open-question', status: 'accepted' },
      { title: 'Rejected idea', status: 'rejected' },
    ]));
  });

  it('proposes a grouping with the configured LLM, excluding linked requirements', async () => {
    llm = new ScriptedLlm('openai', [{ json: { features: [
      { name: 'password-reset', title: 'Password reset', summary: 's', requirementIds: ['REQ-001', 'REQ-002', 'REQ-004'] },
      { name: 'csv-export', title: 'CSV export', summary: 's', requirementIds: ['REQ-003', 'REQ-999'] },
    ] } }]);
    const result = await svc.proposeGrouping('/ws', SET, ['REQ-001', 'REQ-002', 'REQ-003', 'REQ-004']);
    expect(result.groups.map(g => [g.name, g.requirementIds])).toEqual([['password-reset', ['REQ-001', 'REQ-002', 'REQ-004']], ['csv-export', ['REQ-003']]]);
    expect(result.unassigned).toEqual([]);
    expect(llm.calls[0].schemaName).toBe('feature_grouping');
    expect(llm.calls[0].user).toContain('REQ-004 [open-question, should] SSO?');
  });

  it('reports grouping failures as user-facing errors', async () => {
    await expect(svc.proposeGrouping('/ws', SET, [])).rejects.toThrow(/Select at least one/);
    llm = new ScriptedLlm('openai', [new LlmError('auth', 'bad key')]);
    await expect(svc.proposeGrouping('/ws', SET, ['REQ-001'])).rejects.toThrow(/Couldn’t get a suggestion/);
    llm = new ScriptedLlm('openai', [{ json: { features: [] } }]);
    await expect(svc.proposeGrouping('/ws', SET, ['REQ-001'])).rejects.toThrow(/usable grouping/);
  });

  it('creates numbered features, links requirements, commits a copy and runs Specify with them', async () => {
    const events: FeatureEvent[] = [];
    const result = await svc.createFeatures('/ws', SET, [
      { name: 'password-reset', title: 'Password reset', summary: 'Self-service reset', requirementIds: ['REQ-001', 'REQ-002', 'REQ-004'] },
      { name: 'csv-export', title: 'CSV export', requirementIds: ['REQ-003'] },
    ], AGENT, e => events.push(e));

    expect(result.created).toEqual(['002-password-reset', '003-csv-export']);
    expect(result.failed).toEqual([]);
    expect(workflow.runs.map(r => [r.feature, r.phase])).toEqual([['002-password-reset', 'specification'], ['003-csv-export', 'specification']]);
    expect(workflow.runs[0].agent).toBe(AGENT);
    expect(workflow.runs[0].prompt).toContain('Create the feature specification for "Password reset" — Self-service reset.');
    expect(workflow.runs[0].prompt).toContain('REQ-001 (functional, must): Reset password');
    expect(workflow.runs[0].prompt).toContain('Open questions and assumptions:\nREQ-004');
    expect(workflow.runs[0].prompt).not.toContain('CSV export');

    const set = (await reqs.get('/ws', SET))!;
    expect(set.requirements.map(r => r.feature)).toEqual(['002-password-reset', '002-password-reset', '003-csv-export', '002-password-reset', undefined]);
    const copy = parseRequirements(ws.files.get('specs/002-password-reset/requirements.md')!);
    expect(copy.meta).toMatchObject({ title: 'Password reset', setId: SET });
    expect(copy.requirements.map(r => r.id)).toEqual(['REQ-001', 'REQ-002', 'REQ-004']);

    expect(events.map(e => e.type)).toEqual(['start', 'log', 'log', 'done', 'start', 'log', 'log', 'done']);
    expect(events.filter(e => e.type === 'done').every(e => (e as any).ok)).toBe(true);
  });

  it('continues after a failed spec and supports regenerating it', async () => {
    workflow.failFeatures.add('002-a');
    const events: FeatureEvent[] = [];
    const result = await svc.createFeatures('/ws', SET, [
      { name: 'a', title: 'A', requirementIds: ['REQ-001'] },
      { name: 'b', title: 'B', requirementIds: ['REQ-002'] },
    ], AGENT, e => events.push(e));
    expect(result).toMatchObject({ created: ['003-b'], failed: ['002-a'] });
    expect(events.find(e => e.type === 'done' && e.feature === '002-a')).toMatchObject({ ok: false, message: expect.stringContaining('Generate spec') });

    workflow.failFeatures.clear();
    const logs: string[] = [];
    const retry = await svc.generateSpec('/ws', SET, '002-a', AGENT, t => logs.push(t));
    expect(retry.ok).toBe(true);
    expect(workflow.runs.at(-1)).toMatchObject({ feature: '002-a', phase: 'specification' });
    expect(workflow.runs.at(-1)!.prompt).toContain('REQ-001');
    await expect(svc.generateSpec('/ws', SET, '009-none', AGENT, () => {})).rejects.toThrow(/No requirements/);
  });

  it('rejects invalid groups before creating anything and warns when Spec Kit is missing', async () => {
    await expect(svc.createFeatures('/ws', SET, [{ title: 'A', requirementIds: ['REQ-404'] }], AGENT, () => {})).rejects.toThrow(/Unknown requirement/);
    expect(workflow.features).toEqual(['001-existing']);

    ws.files.delete('.specify/templates/spec-template.md');
    const events: FeatureEvent[] = [];
    await svc.createFeatures('/ws', SET, [{ title: 'A', requirementIds: ['REQ-001'] }], AGENT, e => events.push(e));
    expect(events[0]).toMatchObject({ type: 'warning', message: expect.stringContaining('Spec Kit') });

    // REQ-001 is now linked, so it can't go into another feature.
    await expect(svc.createFeatures('/ws', SET, [{ title: 'B', requirementIds: ['REQ-001'] }], AGENT, () => {})).rejects.toThrow(/already part of feature/);
  });
});
