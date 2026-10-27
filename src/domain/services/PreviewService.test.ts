import { describe, it, expect, beforeEach } from 'vitest';
import { PreviewService } from './PreviewService';
import { MemoryHistory, MemoryWorkspace } from '../../test/meetingFakes';
import { DEFAULT_AGENTS } from '../models/agents';
import { PREVIEW_CONFIG_FILE, PreviewConfig, PreviewStatus, STOPPED } from '../models/preview';
import { AgentCommand } from '../ports/out/AgentRunnerPort';
import { PreviewRunnerPort } from '../ports/out/PreviewRunnerPort';

class FakeRunner implements PreviewRunnerPort {
  started: PreviewConfig[] = [];
  stops = 0;
  current: PreviewStatus = STOPPED;
  async start(_ws: string, config: PreviewConfig) { this.started.push(config); this.current = { state: 'starting', command: config.command, logs: '' }; return this.current; }
  async stop() { this.stops++; this.current = STOPPED; }
  status() { return this.current; }
  async stopAll() { this.current = STOPPED; }
}

describe('PreviewService', () => {
  let ws: MemoryWorkspace;
  let history: MemoryHistory;
  let runner: FakeRunner;
  let commands: AgentCommand[];
  let agentWrites: string | null; // what the fake agent writes to preview.json
  let agentExit: number;

  const make = (agents = DEFAULT_AGENTS) => new PreviewService(
    ws,
    runner,
    {
      runCommand: async (_ws: string, command: AgentCommand, _cfg: unknown, onData?: (t: string) => void) => {
        commands.push(command);
        onData?.('agent working\n');
        if (agentWrites !== null) await ws.writeFile('/ws', PREVIEW_CONFIG_FILE, agentWrites);
        return agentExit;
      },
    } as never,
    { getAgents: async () => agents } as never,
    history
  );

  beforeEach(() => {
    ws = new MemoryWorkspace();
    history = new MemoryHistory();
    runner = new FakeRunner();
    commands = [];
    agentWrites = JSON.stringify({ command: 'pnpm dev', port: 5173, path: '/', notes: 'Installed dependencies.' });
    agentExit = 0;
  });

  it('prepares the preview with the active agent and records the run', async () => {
    const logs: string[] = [];
    const r = await make().runAgent('/ws', 'prepare', '001-signup', t => logs.push(t));
    expect(r).toMatchObject({ ok: true, config: { command: 'pnpm dev', port: 5173 } });
    expect(r.message).toContain('Installed dependencies.');
    // A plain instruction (no slash command) that names the feature and the file to write.
    expect(commands[0].command).toBe('');
    expect(commands[0].context).toContain('specs/001-signup/');
    expect(commands[0].context).toContain(PREVIEW_CONFIG_FILE);
    expect(history.records[0]).toMatchObject({ kind: 'preview', feature: '001-signup', label: 'Prepare preview', status: 'passed' });
    expect(logs.join('')).toContain('agent working');
  });

  it('fails clearly when the agent writes nothing usable', async () => {
    agentWrites = null;
    agentExit = 1;
    const r = await make().runAgent('/ws', 'prepare', null);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('without writing .specify/preview.json');
    expect(history.records[0].status).toBe('failed');

    agentWrites = '{"port": 3000}';
    const bad = await make().runAgent('/ws', 'prepare', null);
    expect(bad).toMatchObject({ ok: false, message: expect.stringContaining('needs a "command"') });
  });

  it('hands the failed output to the agent when fixing', async () => {
    await ws.writeFile('/ws', PREVIEW_CONFIG_FILE, JSON.stringify({ command: 'npm run dev' }));
    runner.current = { state: 'failed', command: 'npm run dev', logs: 'Error: Cannot find module next', error: 'The command exited early.' };
    const r = await make().runAgent('/ws', 'fix', null);
    expect(r.ok).toBe(true);
    expect(commands[0].context).toContain('Cannot find module next');
    expect(commands[0].context).toContain('The command exited early.');
    expect(runner.stops).toBe(1); // port freed for the agent's own check
  });

  it('needs an active agent', async () => {
    const r = await make({ agents: [], activeAgentId: null } as never).runAgent('/ws', 'prepare', null);
    expect(r).toMatchObject({ ok: false, message: expect.stringContaining('Agents section') });
    expect(commands).toHaveLength(0);
  });

  it('starts from the saved command, and saves edits', async () => {
    const svc = make();
    await expect(svc.start('/ws')).rejects.toThrow('No preview command yet');
    await svc.saveConfig('/ws', { command: 'bin/rails server -p {port}', path: 'admin' });
    await svc.start('/ws');
    expect(runner.started[0]).toEqual({ command: 'bin/rails server -p {port}', path: '/admin' });
    expect((await svc.view('/ws')).status.state).toBe('starting');
    await expect(svc.saveConfig('/ws', { command: '' })).rejects.toThrow('needs a "command"');
  });
});
