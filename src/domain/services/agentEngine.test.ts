import { describe, it, expect, beforeEach } from 'vitest';
import { MeetingImportService, GITIGNORE_ENTRY } from './MeetingImportService';
import { FeatureCreationService } from './FeatureCreationService';
import { IntegrationsService } from './IntegrationsService';
import { RequirementsService } from './RequirementsService';
import { MeetingAgentRunner, MeetingAgentReadiness } from './MeetingAgentRunner';
import { MemoryCredentials, MemoryHistory, MemoryWorkspace, ScriptedLlm } from '../../test/meetingFakes';
import { appendRequirements } from './requirementsOps';
import { emptyRequirementsDoc, parseRequirements } from './requirementsMarkdown';
import { ZOOM_MCP_PRESET } from '../models/mcp';
import { IntegrationCredentials } from '../models/credentials';

// A fake agent: each run applies the next scripted behavior, which writes files
// into the workspace the way the real /speckit.meetings.* commands would.
type Behavior = (ws: MemoryWorkspace, args: string, context?: string) => number | void;

class FakeAgent {
  runs: Array<{ kind: string; args: string; context?: string; zoom?: string }> = [];
  readinessResult: MeetingAgentReadiness = { ok: true, problems: [], agentLabel: 'Claude (Default)', agentConfig: { agentType: 'claude' }, zoomServer: ZOOM_MCP_PRESET };
  constructor(private ws: MemoryWorkspace, public script: Behavior[] = []) {}
  async readiness() { return this.readinessResult; }
  async run(_w: string, kind: string, opts: any) {
    this.runs.push({ kind, args: opts.args, context: opts.context, zoom: opts.zoomServer?.name });
    opts.onData?.('agent log\n');
    const b = this.script.shift();
    const exitCode = (b ? b(this.ws, opts.args, opts.context) : 0) ?? 0;
    return { exitCode, cost: { source: 'estimated' as const, totalTokens: 500 } };
  }
}

const EXTRACTION = JSON.stringify({
  title: 'QuickBite planning',
  requirements: [
    { title: 'Live driver tracking', type: 'functional', priority: 'must', description: 'd', acceptanceCriteria: ['every 10s'], sourceTimestamp: '00:00:14', sourceSpeaker: 'Lina', sourceQuote: 'where is my order' },
    { title: 'Combine promo + loyalty?', type: 'open-question', priority: 'should', description: '', acceptanceCriteria: [], sourceTimestamp: '', sourceSpeaker: '', sourceQuote: '' },
  ],
});
const dirOf = (args: string) => args.split(' ')[0];

describe('agent engine', () => {
  let ws: MemoryWorkspace;
  let history: MemoryHistory;
  let agent: FakeAgent;
  let creds: MemoryCredentials;
  const integrations = () => new IntegrationsService(creds, () => new ScriptedLlm('openai', []), {});
  const importer = () => new MeetingImportService(ws, new RequirementsService(ws, undefined, () => 1_000), integrations(), () => { throw new Error('direct Zoom not used'); }, history, () => 1_000, agent as unknown as MeetingAgentRunner);

  beforeEach(() => {
    ws = new MemoryWorkspace();
    history = new MemoryHistory();
    creds = new MemoryCredentials();
    agent = new FakeAgent(ws);
  });

  it('defaults to the agent without a key, keeps direct for existing key setups, honors explicit choice', async () => {
    expect(await integrations().getEngine()).toBe('agent');
    creds = new MemoryCredentials({ llm: { provider: 'openai', keys: { openai: 'sk-1234567890' }, models: {} } });
    expect(await integrations().getEngine()).toBe('direct');
    creds = new MemoryCredentials({ engine: 'agent', llm: { provider: 'openai', keys: { openai: 'sk-1234567890' }, models: {} } } as IntegrationCredentials);
    expect(await integrations().getEngine()).toBe('agent');
    await expect(integrations().update({ engine: 'robot' as never })).rejects.toThrow(/Unknown requirements engine/);
  });

  it('imports an uploaded transcript via /speckit.meetings.import', async () => {
    agent.script = [(w, args) => { w.files.set(`${dirOf(args)}/extraction.json`, EXTRACTION); w.files.set(`${dirOf(args)}/status.json`, '{"status":"ok","topic":"","startTime":""}'); }];
    const out = await importer().import({ workspacePath: '/ws', input: { type: 'transcript', text: 'Lina: where is my order?', filename: 'dummy.txt' } });
    expect(out.status).toBe('ok');
    expect(out.setId).toBe('1970-01-01-dummy');
    expect(agent.runs).toEqual([{ kind: 'import', args: '.specify/meetings/1970-01-01-dummy', context: undefined, zoom: ZOOM_MCP_PRESET.name }]);
    // The app wrote the transcript for the agent, and requirements.md from the validated JSON.
    expect(ws.files.get('.specify/meetings/1970-01-01-dummy/transcript.md')).toBe('Lina: where is my order?\n');
    const doc = parseRequirements(ws.files.get('.specify/meetings/1970-01-01-dummy/requirements.md')!);
    expect(doc.meta).toMatchObject({ title: 'QuickBite planning', source: 'upload' });
    expect(doc.requirements.map(r => [r.id, r.type, r.status])).toEqual([['REQ-001', 'functional', 'draft'], ['REQ-002', 'open-question', 'draft']]);
    expect(ws.files.get('.gitignore')).toContain(GITIGNORE_ENTRY);
    expect(history.records[0]).toMatchObject({ kind: 'meeting', status: 'passed', command: 'Claude (Default): /speckit.meetings.import' });
    expect(history.records[0].log).toContain('agent log');
    expect(out.cost).toMatchObject({ totalTokens: 500 });
  });

  it('imports a converted document, telling the agent to read document.md', async () => {
    agent.script = [(w, args, context) => {
      const d = dirOf(args);
      if (!context?.includes(`${d}/document.md`)) return 1;
      w.files.set(`${d}/extraction.json`, EXTRACTION);
      w.files.set(`${d}/status.json`, '{"status":"ok","topic":"","startTime":""}');
    }];
    const reader = { read: async () => ({ text: '# QuickBite PRD\n\n- Live driver tracking', format: 'docx' }) };
    const svc = new MeetingImportService(ws, new RequirementsService(ws, undefined, () => 1_000), integrations(), () => { throw new Error('direct Zoom not used'); }, history, () => 1_000, agent as unknown as MeetingAgentRunner, undefined, reader);
    const out = await svc.import({ workspacePath: '/ws', input: { type: 'document', data: Buffer.from('x'), filename: 'QuickBite PRD.docx' } });
    expect(out.status).toBe('ok');
    const d = '.specify/meetings/1970-01-01-quickbite-prd';
    expect(ws.files.get(`${d}/document.md`)).toBe('# QuickBite PRD\n\n- Live driver tracking\n');
    expect(agent.runs[0].context).toContain('converted from QuickBite PRD.docx');
    expect(history.records[0]).toMatchObject({ label: 'Document QuickBite PRD.docx', status: 'passed' });
    expect(parseRequirements(ws.files.get(`${d}/requirements.md`)!).requirements).toHaveLength(2);
  });

  it('passes the Zoom meeting id and uses the transcript and topic the agent fetched', async () => {
    agent.script = [(w, args) => {
      const d = dirOf(args);
      w.files.set(`${d}/transcript.md`, '[00:00:14] Lina: where is my order?');
      w.files.set(`${d}/summary.md`, 'Agreed on tracking.');
      w.files.set(`${d}/status.json`, '{"status":"ok","topic":"QuickBite sync","startTime":"2026-10-22"}');
      w.files.set(`${d}/extraction.json`, '```json\n' + EXTRACTION + '\n```');
    }];
    const out = await importer().import({ workspacePath: '/ws', input: { type: 'link', value: 'https://zoom.us/j/85012345678' } });
    expect(out.status).toBe('ok');
    expect(agent.runs[0].args).toBe(`.specify/meetings/1970-01-01-zoom-meeting-85012345678 85012345678`);
    expect(out.doc!.meta).toMatchObject({ source: 'zoom', meetingId: '85012345678', meetingTopic: 'QuickBite sync', meetingDate: '2026-10-22' });
  });

  it('retries once with the validation error, then reports invalid_output', async () => {
    agent.script = [
      (w, args) => { w.files.set(`${dirOf(args)}/extraction.json`, '{"requirements":[{"title":"x","type":"epic"}]}'); },
      (w, args) => { w.files.set(`${dirOf(args)}/extraction.json`, EXTRACTION); },
    ];
    expect((await importer().import({ workspacePath: '/ws', input: { type: 'transcript', text: 't', filename: 'a.txt' } })).status).toBe('ok');
    expect(agent.runs[1].context).toMatch(/was rejected: requirements\[0\]\.type "epic"/);

    agent.runs = [];
    agent.script = [(w, args) => { w.files.set(`${dirOf(args)}/extraction.json`, 'not json'); }, () => {}];
    const out = await importer().import({ workspacePath: '/ws', input: { type: 'transcript', text: 't', filename: 'b.txt' } });
    expect(out.status).toBe('invalid_output');
    expect(agent.runs).toHaveLength(2);
    expect(history.records.at(-1)!.status).toBe('failed');
  });

  it.each([['not_found'], ['no_transcript'], ['auth_required']])('maps the agent’s %s status', async code => {
    agent.script = [(w, args) => { w.files.set(`${dirOf(args)}/status.json`, JSON.stringify({ status: code, message: `zoom says ${code}` })); }];
    const out = await importer().import({ workspacePath: '/ws', input: { type: 'link', value: '85012345678' } });
    expect(out).toMatchObject({ status: code, message: `zoom says ${code}` });
    expect(agent.runs).toHaveLength(1);
  });

  it('reports an agent crash, and stops before running when not ready', async () => {
    agent.script = [() => 2];
    expect((await importer().import({ workspacePath: '/ws', input: { type: 'transcript', text: 't', filename: 'c.txt' } })).message).toMatch(/exited with code 2/);

    agent.runs = [];
    agent.readinessResult = { ok: false, problems: ['Install “Meeting Requirements” from the Extensions section.'] };
    const out = await importer().import({ workspacePath: '/ws', input: { type: 'transcript', text: 't', filename: 'd.txt' } });
    expect(out).toMatchObject({ status: 'not_configured', message: expect.stringContaining('Extensions') });
    expect(agent.runs).toEqual([]);
  });

  it('groups via /speckit.meetings.group and validates grouping.json', async () => {
    const reqs = new RequirementsService(ws);
    const SET = 's1';
    await reqs.save('/ws', SET, appendRequirements(emptyRequirementsDoc(), [
      { title: 'Tracking', status: 'accepted' }, { title: 'Promo codes', status: 'accepted' }, { title: 'Combine?', type: 'open-question', status: 'accepted' },
    ]));
    agent.script = [
      () => {}, // wrote nothing → retry
      w => {
        expect(JSON.parse(w.files.get('.specify/meetings/s1/grouping-request.json')!)).toEqual({ requirementIds: ['REQ-001', 'REQ-002', 'REQ-003'] });
        w.files.set('.specify/meetings/s1/grouping.json', JSON.stringify({ features: [
          { name: 'live-tracking', title: 'Live tracking', summary: 's', requirementIds: ['REQ-001'] },
          { name: 'promo-codes', title: 'Promo codes', summary: 's', requirementIds: ['REQ-002', 'REQ-003', 'REQ-999'] },
        ] }));
      },
    ];
    const svc = new FeatureCreationService(ws, reqs, integrations(), {} as never, agent as unknown as MeetingAgentRunner, history);
    const result = await svc.proposeGrouping('/ws', SET, ['REQ-001', 'REQ-002', 'REQ-003']);
    expect(result.groups.map(g => [g.name, g.requirementIds])).toEqual([['live-tracking', ['REQ-001']], ['promo-codes', ['REQ-002', 'REQ-003']]]);
    expect(agent.runs.map(r => [r.kind, r.args])).toEqual([['group', '.specify/meetings/s1'], ['group', '.specify/meetings/s1']]);
    expect(agent.runs[1].context).toMatch(/missing or not valid JSON/);
    expect(history.records.at(-1)).toMatchObject({ kind: 'meeting', status: 'passed', command: 'Claude (Default): /speckit.meetings.group' });

    agent.readinessResult = { ok: false, problems: ['Select an agent in the Agents section.'] };
    await expect(svc.proposeGrouping('/ws', SET, ['REQ-001'])).rejects.toThrow(/Select an agent/);
  });
});
