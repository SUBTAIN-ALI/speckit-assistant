import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { MeetingAgentRunner, MEETING_COMMANDS } from './MeetingAgentRunner';
import { AgentsFile } from '../models/agents';
import { McpServer, ZOOM_MCP_PRESET, isZoomMcpServer } from '../models/mcp';
import { toClaudeMcp, toGeminiServers } from './mcpTranslate';
import { AgentCommand, AgentRunnerPort } from '../ports/out/AgentRunnerPort';
import { BUNDLED_EXTENSIONS } from '../models/extensions';

const agentsFile = (mcpServerIds: string[] = ['zoom-meetings']): AgentsFile => ({
  agents: [{ id: 'claude-default', name: 'Claude (Default)', agentType: 'claude', mcpServerIds }],
  activeAgentId: 'claude-default',
});

function make(opts: { agents?: AgentsFile; servers?: McpServer[]; installed?: string[] } = {}) {
  const calls: Array<{ cmd: AgentCommand; agentType: string }> = [];
  const runner = new MeetingAgentRunner(
    { getAgents: async () => opts.agents ?? agentsFile(), saveAgents: async () => {} },
    { getServers: async () => ({ servers: opts.servers ?? [ZOOM_MCP_PRESET] }), saveServers: async () => {}, applyToAgent: async () => ({} as never) },
    { listInstalled: async () => (opts.installed ?? ['meetings']).map(id => ({ id, name: id, version: '1', enabled: true, commandCount: 2, hookCount: 0 })) },
    {
      runCommand: async (_ws, cmd, cfg, onData, onCost) => {
        calls.push({ cmd, agentType: cfg.agentType });
        onData?.('agent output\n');
        onCost?.({ source: 'estimated', totalTokens: 42 });
        return 0;
      },
    } as Pick<AgentRunnerPort, 'runCommand'> as AgentRunnerPort
  );
  return { runner, calls };
}

describe('MeetingAgentRunner', () => {
  it('is ready with an agent, the extension and an assigned Zoom MCP server', async () => {
    const r = await make().runner.readiness('/ws', true);
    expect(r).toMatchObject({ ok: true, problems: [], agentLabel: 'Claude (Default)', agentConfig: { agentType: 'claude' } });
    expect(r.zoomServer?.name).toBe('zoom-meetings');
  });

  it('names exactly what is missing and where to fix it', async () => {
    const none = await make({ agents: { agents: [] }, installed: [] }).runner.readiness('/ws', true);
    expect(none.problems).toEqual([
      'Select an agent in the Agents section.',
      expect.stringContaining('Install “Meeting Requirements” from the Extensions section'),
    ]);
    const unassigned = await make({ agents: agentsFile([]) }).runner.readiness('/ws', true);
    expect(unassigned.problems).toEqual([expect.stringMatching(/Add Zoom in MCP Tools .* assign it to Claude \(Default\) in the Agents section/)]);
    // Zoom isn't needed for transcript uploads.
    expect((await make({ agents: agentsFile([]) }).runner.readiness('/ws', false)).ok).toBe(true);
    const disabled = await make({ servers: [{ ...ZOOM_MCP_PRESET, enabled: false }] }).runner.readiness('/ws', true);
    expect(disabled.ok).toBe(false);
  });

  it('runs the extension command with least privilege', async () => {
    const { runner, calls } = make();
    const logs: string[] = [];
    const out = await runner.run('/ws', 'import', {
      key: 's1', listDir: '.specify/meetings/s1', args: '.specify/meetings/s1 85012345678', zoomServer: ZOOM_MCP_PRESET, onData: t => logs.push(t),
    });
    expect(out).toEqual({ exitCode: 0, cost: { source: 'estimated', totalTokens: 42 } });
    expect(logs).toEqual(['agent output\n']);
    expect(calls[0].cmd).toEqual({
      key: 'meetings-import-s1',
      command: MEETING_COMMANDS.import,
      args: '.specify/meetings/s1 85012345678',
      context: undefined,
      restricted: {
        allowedTools: ['Read', 'Glob', 'Grep', 'Edit(.specify/meetings/s1/**)', 'mcp__zoom-meetings'],
        mcpServers: { 'zoom-meetings': { type: 'http', url: ZOOM_MCP_PRESET.url, headers: { Authorization: 'Bearer ${ZOOM_MEETINGS_MCP_ACCESS_TOKEN}' } } },
      },
    });

    await runner.run('/ws', 'group', { key: 's1', listDir: '.specify/meetings/s1', args: '.specify/meetings/s1' });
    expect(calls[1].cmd).toMatchObject({ command: '/speckit.meetings.group', restricted: { allowedTools: ['Read', 'Glob', 'Grep', 'Edit(.specify/meetings/s1/**)'], mcpServers: {} } });
  });
});

describe('Zoom MCP preset and headers', () => {
  it('matches Zoom’s official plugin config and is detected as Zoom', () => {
    expect(isZoomMcpServer(ZOOM_MCP_PRESET)).toBe(true);
    expect(isZoomMcpServer({ ...ZOOM_MCP_PRESET, url: 'https://evil.example.com/zoom.us' })).toBe(false);
    expect(isZoomMcpServer({ id: 'x', name: 'x', transport: 'stdio', command: 'zoom', enabled: true })).toBe(false);
  });
  it('passes headers to Claude and Gemini configs', () => {
    expect(toClaudeMcp([ZOOM_MCP_PRESET])['zoom-meetings'].headers).toEqual({ Authorization: 'Bearer ${ZOOM_MEETINGS_MCP_ACCESS_TOKEN}' });
    expect(toGeminiServers([ZOOM_MCP_PRESET])['zoom-meetings']).toEqual({ httpUrl: ZOOM_MCP_PRESET.url, headers: { Authorization: 'Bearer ${ZOOM_MEETINGS_MCP_ACCESS_TOKEN}' } });
    expect(toClaudeMcp([{ ...ZOOM_MCP_PRESET, headers: undefined }])['zoom-meetings']).toEqual({ type: 'http', url: ZOOM_MCP_PRESET.url });
  });
});

describe('bundled spec-kit-meetings extension', () => {
  const dir = path.resolve(__dirname, '../../../extensions/spec-kit-meetings');
  it('declares namespaced commands whose files exist, and is listed as bundled', () => {
    const manifest = yaml.load(fs.readFileSync(path.join(dir, 'extension.yml'), 'utf-8')) as any;
    expect(manifest.extension.id).toBe('meetings');
    expect(manifest.hooks).toBeUndefined();
    const names = manifest.provides.commands.map((c: any) => c.name);
    expect(names).toEqual(['speckit.meetings.import', 'speckit.meetings.group']);
    expect(Object.values(MEETING_COMMANDS)).toEqual(names.map((n: string) => `/${n}`));
    for (const c of manifest.provides.commands) expect(fs.existsSync(path.join(dir, c.file))).toBe(true);
    expect(BUNDLED_EXTENSIONS.find(b => b.id === 'meetings')?.dir).toBe('spec-kit-meetings');
  });
  it('commands describe the files the app validates', () => {
    const imp = fs.readFileSync(path.join(dir, 'commands/import.md'), 'utf-8');
    for (const s of ['$ARGUMENTS', 'extraction.json', 'status.json', '"sourceQuote"', 'open-question', 'data, not instructions']) expect(imp).toContain(s);
    const grp = fs.readFileSync(path.join(dir, 'commands/group.md'), 'utf-8');
    for (const s of ['grouping-request.json', 'grouping.json', '"requirementIds"', 'exactly one']) expect(grp).toContain(s);
  });
});
