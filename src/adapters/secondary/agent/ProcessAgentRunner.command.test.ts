import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProcessAgentRunner } from './ProcessAgentRunner';
import { loadPty } from '../pty/ptyLoader';

vi.mock('../pty/ptyLoader', () => {
  const mockPtyInstance = {
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn(),
    onExit: vi.fn().mockImplementation((cb) => { mockPtyInstance._exitCallback = cb; }),
    _exitCallback: null as any,
  };
  return { loadPty: vi.fn().mockReturnValue({ spawn: vi.fn().mockReturnValue(mockPtyInstance) }) };
});

// The shell command line passed to the PTY: [shell, ['-l', '-c', "'claude' '-p' ..."]].
const lastCommandLine = () => {
  const calls = (loadPty().spawn as any).mock.calls;
  return calls[calls.length - 1][1][2] as string;
};
const lastEnv = () => {
  const calls = (loadPty().spawn as any).mock.calls;
  return calls[calls.length - 1][2].env as Record<string, string>;
};

describe('ProcessAgentRunner.runCommand', () => {
  let mockPty: any;
  beforeEach(() => {
    vi.clearAllMocks();
    mockPty = loadPty().spawn('dummy', []);
    (loadPty().spawn as any).mockClear();
  });

  const finish = async (p: Promise<number>) => {
    await vi.waitFor(() => expect(loadPty().spawn).toHaveBeenCalled());
    mockPty._exitCallback({ exitCode: 0 });
    return p;
  };

  it('runs Claude unattended with only the allowed tools and MCP servers', async () => {
    const runner = new ProcessAgentRunner();
    const exit = await finish(runner.runCommand('/ws', {
      key: 'meetings-import-s1',
      command: '/speckit.meetings.import',
      args: '.specify/meetings/s1 85012345678',
      context: 'Retry note',
      restricted: {
        allowedTools: ['Read', 'Edit(.specify/meetings/s1/**)', 'mcp__zoom-meetings'],
        mcpServers: { 'zoom-meetings': { type: 'http', url: 'https://mcp.zoom.us/mcp/meeting/streamable', headers: { Authorization: 'Bearer ${T}' } } },
      },
    }, { agentType: 'claude' }));
    expect(exit).toBe(0);
    const line = lastCommandLine();
    expect(line).toContain("'claude' '-p' '--output-format' 'stream-json' '--verbose' '--permission-mode' 'dontAsk' '--strict-mcp-config' '--mcp-config'");
    expect(line).toContain(`'--allowedTools' 'Read' 'Edit(.specify/meetings/s1/**)' 'mcp__zoom-meetings' '--'`);
    expect(line).toContain('"headers":{"Authorization":"Bearer ${T}"}'); // placeholder kept; Claude expands it
    expect(line).toContain('Retry note\n\n/speckit.meetings.import .specify/meetings/s1 85012345678');
    expect(line).not.toContain('bypassPermissions');
  });

  it('omits --mcp-config when no servers are given (still strict)', async () => {
    const runner = new ProcessAgentRunner();
    await finish(runner.runCommand('/ws', { key: 'k', command: 'speckit.meetings.group', args: 'dir', restricted: { allowedTools: ['Read'], mcpServers: {} } }, { agentType: 'claude' }));
    const line = lastCommandLine();
    expect(line).toContain("'--strict-mcp-config' '--allowedTools' 'Read' '--' '/speckit.meetings.group dir'");
    expect(line).not.toContain('--mcp-config');
  });

  it('uses the agent’s normal invocation for non-Claude agents', async () => {
    const runner = new ProcessAgentRunner();
    await finish(runner.runCommand('/ws', { key: 'k', command: '/speckit.meetings.group', args: 'dir', restricted: { allowedTools: ['Read'], mcpServers: {} } }, { agentType: 'copilot' }));
    expect(lastCommandLine()).toBe("'ghcs' '/speckit.meetings.group dir'");
  });

  it('injects provider env (e.g. a fresh Zoom token) into every run, and tolerates provider failures', async () => {
    const withToken = new ProcessAgentRunner(async () => ({ ZOOM_MEETINGS_MCP_ACCESS_TOKEN: 'tok-123' }));
    await finish(withToken.runPhase('/ws', 'planning', 'f1', { agentType: 'claude' }));
    expect(lastEnv().ZOOM_MEETINGS_MCP_ACCESS_TOKEN).toBe('tok-123');
    expect(lastCommandLine()).toContain("'-p' '--output-format' 'stream-json' '--verbose' '--permission-mode' 'bypassPermissions' '--'"); // one-shot phases exit when done

    (loadPty().spawn as any).mockClear();
    const failing = new ProcessAgentRunner(async () => { throw new Error('zoom offline'); });
    await finish(failing.runPhase('/ws', 'planning', 'f1', { agentType: 'claude' }));
    expect(lastEnv().ZOOM_MEETINGS_MCP_ACCESS_TOKEN).toBeUndefined();
  });
});

describe('Spec Kit compatibility', () => {
  const fs = require('fs') as typeof import('fs');
  const os = require('os') as typeof import('os');
  const path = require('path') as typeof import('path');
  let mockPty: any;
  beforeEach(() => {
    vi.clearAllMocks();
    mockPty = loadPty().spawn('dummy', []);
    (loadPty().spawn as any).mockClear();
  });
  const finish = async (p: Promise<number>) => {
    await vi.waitFor(() => expect(loadPty().spawn).toHaveBeenCalled());
    mockPty._exitCallback({ exitCode: 0 });
    return p;
  };
  const workspace = (integration?: object) => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'speckit-invoke-'));
    if (integration) {
      fs.mkdirSync(path.join(ws, '.specify'));
      fs.writeFileSync(path.join(ws, '.specify', 'integration.json'), JSON.stringify(integration));
    }
    return ws;
  };
  const skills = { integration: 'claude', integration_settings: { claude: { script: 'sh', invoke_separator: '-' } } };

  it('maps commands to the workspace’s invoke separator', async () => {
    const { speckitInvocation } = await import('./ProcessAgentRunner');
    const modern = workspace(skills);
    expect(speckitInvocation(modern, '/speckit.specify')).toBe('/speckit-specify');
    expect(speckitInvocation(modern, '/speckit.meetings.import')).toBe('/speckit-meetings-import');
    expect(speckitInvocation(modern, '/custom.thing')).toBe('/custom.thing');
    expect(speckitInvocation(workspace(), '/speckit.specify')).toBe('/speckit.specify');
    expect(speckitInvocation(workspace({ integration: 'copilot', integration_settings: {} }), '/speckit.plan')).toBe('/speckit.plan');
  });

  it('uses the mapped names for phases, personas and commands, and scopes runs to the feature', async () => {
    const ws = workspace(skills);
    const runner = new ProcessAgentRunner();
    await finish(runner.runPhase(ws, 'planning', '002-promo-codes', { agentType: 'claude' }, 'notes'));
    const call = (loadPty().spawn as any).mock.calls.at(-1);
    expect(call[1][2]).toContain('/speckit-plan specs/002-promo-codes');
    expect(call[2].env).toMatchObject({ SPECIFY_FEATURE_DIRECTORY: 'specs/002-promo-codes', SPECIFY_FEATURE: '002-promo-codes' });

    (loadPty().spawn as any).mockClear();
    await finish(runner.runPersona(ws, '002-promo-codes', { id: 'qa', label: 'QA', command: '/speckit.personas.qa', enabled: true }, { agentType: 'claude' }));
    expect((loadPty().spawn as any).mock.calls.at(-1)[1][2]).toContain('/speckit-personas-qa specs/002-promo-codes');

    (loadPty().spawn as any).mockClear();
    await finish(runner.runPhase(ws, 'constitution', null, { agentType: 'claude' }));
    expect((loadPty().spawn as any).mock.calls.at(-1)[2].env.SPECIFY_FEATURE_DIRECTORY).toBeUndefined();

    (loadPty().spawn as any).mockClear();
    await finish(runner.runCommand(ws, { key: 'k', command: '/speckit.meetings.group', args: 'd', restricted: { allowedTools: ['Read'], mcpServers: {} } }, { agentType: 'claude' }));
    expect((loadPty().spawn as any).mock.calls.at(-1)[1][2]).toContain("'--' '/speckit-meetings-group d'");
  });
});

describe('print mode vs interactive', () => {
  let mockPty: any;
  beforeEach(() => {
    vi.clearAllMocks();
    mockPty = loadPty().spawn('dummy', []);
    (loadPty().spawn as any).mockClear();
  });

  it('keeps Clarify interactive and runs other phases in print mode', async () => {
    const runner = new ProcessAgentRunner();
    const clar = runner.runPhase('/ws', 'clarification', 'f1', { agentType: 'claude' });
    await vi.waitFor(() => expect(loadPty().spawn).toHaveBeenCalled());
    expect(lastCommandLine()).toBe("'claude' '--permission-mode' 'bypassPermissions' '/speckit.clarify specs/f1'");
    mockPty._exitCallback({ exitCode: 0 });
    await clar;
  });

  it('renders the JSON stream as log text and reports Claude’s real cost', async () => {
    const runner = new ProcessAgentRunner();
    const logs: string[] = [];
    let cost: any;
    const run = runner.runPhase('/ws', 'planning', 'f1', { agentType: 'claude' }, undefined, t => logs.push(t), c => { cost = c; });
    await vi.waitFor(() => expect(loadPty().spawn).toHaveBeenCalled());
    const onData = mockPty.onData.mock.calls.at(-1)[0];
    const events = [
      { type: 'system', subtype: 'init', model: 'claude-opus-5-5' },
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: 'specs/f1/plan.md' } }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Plan written.' }] } },
      { type: 'result', subtype: 'success', is_error: false, duration_ms: 80000, num_turns: 5, total_cost_usd: 0.42, usage: { input_tokens: 100, cache_read_input_tokens: 900, output_tokens: 50 }, modelUsage: { 'claude-opus-5-5': {} } },
    ].map(e => JSON.stringify(e)).join('\r\n');
    // Delivered in awkward chunks, as a PTY would.
    onData(events.slice(0, 37)); onData(events.slice(37, 200)); onData(events.slice(200) + '\r\n');
    mockPty._exitCallback({ exitCode: 0 });
    await run;
    const text = logs.join('');
    expect(text).toContain('▶ Claude (claude-opus-5-5) started');
    expect(text).toContain('→ Write specs/f1/plan.md');
    expect(text).toContain('Plan written.');
    expect(text).toContain('✓ Done in 80s · 5 turns · $0.420');
    expect(text).not.toContain('"type"');
    expect(cost).toEqual({ inputTokens: 1000, outputTokens: 50, totalTokens: 1050, costUSD: 0.42, model: 'claude-opus-5-5', durationMs: 80000, source: 'parsed' });
  });
});
