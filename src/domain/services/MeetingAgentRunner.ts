import { AgentConfig, CostMetadata } from '../models/types';
import { AgentProfile, activeAgent, toAgentConfig } from '../models/agents';
import { McpServer, isZoomMcpServer } from '../models/mcp';
import { AgentRepositoryPort } from '../ports/out/AgentRepositoryPort';
import { AgentRunnerPort } from '../ports/out/AgentRunnerPort';
import { ExtensionRepositoryPort } from '../ports/out/ExtensionRepositoryPort';
import { McpConfigPort } from '../ports/out/McpConfigPort';
import { toClaudeMcp } from './mcpTranslate';

// Runs the bundled meetings extension's commands with the active agent — the
// same way DevOps agents run on demand — in a least-privilege mode: the agent
// may only read, edit files inside the requirement list's folder, and (for
// Zoom imports) use the Zoom MCP server assigned to it in Agents.

export const MEETINGS_EXTENSION_ID = 'meetings';
export const MEETING_COMMANDS = {
  import: '/speckit.meetings.import',
  group: '/speckit.meetings.group',
} as const;

export type MeetingAgentReadiness = {
  ok: boolean;
  problems: string[];
  agentLabel?: string;
  agentConfig?: AgentConfig;
  zoomServer?: McpServer; // the Zoom MCP server assigned to the agent, if any
};

export class MeetingAgentRunner {
  constructor(
    private agents: AgentRepositoryPort,
    private mcp: McpConfigPort,
    private extensions: ExtensionRepositoryPort,
    private runner: AgentRunnerPort
  ) {}

  private async active(workspacePath: string): Promise<AgentProfile | null> {
    return activeAgent(await this.agents.getAgents(workspacePath));
  }

  // What's missing before the agent can run (each problem is user-facing).
  async readiness(workspacePath: string, needsZoom: boolean): Promise<MeetingAgentReadiness> {
    const problems: string[] = [];
    const profile = await this.active(workspacePath);
    if (!profile) problems.push('Select an agent in the Agents section.');

    const installed = await this.extensions.listInstalled(workspacePath);
    if (!installed.some(e => e.id === MEETINGS_EXTENSION_ID && e.enabled)) {
      problems.push('Install “Meeting Requirements” from the Extensions section (it provides the /speckit.meetings.* commands).');
    }

    let zoomServer: McpServer | undefined;
    if (profile) {
      const assigned = new Set(profile.mcpServerIds ?? []);
      const { servers } = await this.mcp.getServers(workspacePath);
      zoomServer = servers.find(s => s.enabled && isZoomMcpServer(s) && assigned.has(s.id));
      if (needsZoom && !zoomServer) {
        problems.push(`Add Zoom in MCP Tools (“Add Zoom”) and assign it to ${profile.name} in the Agents section.`);
      }
    }
    return {
      ok: problems.length === 0,
      problems,
      agentLabel: profile?.name,
      agentConfig: profile ? toAgentConfig(profile) : undefined,
      zoomServer,
    };
  }

  async run(
    workspacePath: string,
    kind: keyof typeof MEETING_COMMANDS,
    opts: {
      key: string; // e.g. the set id
      listDir: string; // the only folder the agent may write to
      args: string;
      context?: string;
      zoomServer?: McpServer;
      onData?: (text: string) => void;
    }
  ): Promise<{ exitCode: number; cost?: CostMetadata }> {
    const profile = await this.active(workspacePath);
    if (!profile) throw new Error('Select an agent in the Agents section.');
    const zoom = opts.zoomServer;
    let cost: CostMetadata | undefined;
    const exitCode = await this.runner.runCommand(
      workspacePath,
      {
        key: `meetings-${kind}-${opts.key}`,
        command: MEETING_COMMANDS[kind],
        args: opts.args,
        context: opts.context,
        restricted: {
          allowedTools: ['Read', 'Glob', 'Grep', `Edit(${opts.listDir}/**)`, ...(zoom ? [`mcp__${zoom.name}`] : [])],
          mcpServers: zoom ? toClaudeMcp([zoom]) : {},
        },
      },
      toAgentConfig(profile),
      opts.onData,
      c => { cost = c; }
    );
    return { exitCode, cost };
  }
}
