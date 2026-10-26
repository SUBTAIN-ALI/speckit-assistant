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
    expect(line).toContain("'claude' '-p' '--permission-mode' 'dontAsk' '--strict-mcp-config' '--mcp-config'");
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
    expect(lastCommandLine()).toContain('bypassPermissions'); // phases keep the repo's existing mode

    (loadPty().spawn as any).mockClear();
    const failing = new ProcessAgentRunner(async () => { throw new Error('zoom offline'); });
    await finish(failing.runPhase('/ws', 'planning', 'f1', { agentType: 'claude' }));
    expect(lastEnv().ZOOM_MEETINGS_MCP_ACCESS_TOKEN).toBeUndefined();
  });
});
