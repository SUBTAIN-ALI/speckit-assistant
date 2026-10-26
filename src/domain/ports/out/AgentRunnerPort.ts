import { WorkflowPhase, AgentConfig, PersonaConfig, PersonaId, CostMetadata } from '../../models/types';
import { DevOpsAgent } from '../../models/devopsAgents';

// An on-demand slash command run by the active agent CLI (e.g. a bundled
// extension command like /speckit.meetings.import).
export type AgentCommand = {
  key: string; // identifies the process (for stop / stdin)
  command: string; // "/speckit.meetings.import"
  args?: string; // becomes $ARGUMENTS
  context?: string; // extra instructions placed before the command
  // Run unattended with only these tools and MCP servers (enforced for Claude:
  // non-interactive, anything else is denied instead of prompting).
  restricted?: {
    allowedTools: string[];
    mcpServers: Record<string, unknown>; // native Claude .mcp.json "mcpServers" map
  };
};

export interface AgentRunnerPort {
  runCommand(
    workspacePath: string,
    command: AgentCommand,
    agentConfig: AgentConfig,
    onData?: (text: string) => void,
    onCost?: (cost: CostMetadata) => void
  ): Promise<number>;
  runPhase(
    workspacePath: string,
    phase: WorkflowPhase,
    featureName: string | null,
    agentConfig: AgentConfig,
    userPrompt?: string,
    onData?: (text: string) => void,
    // Invoked once at process exit with the captured cost/usage of the run.
    onCost?: (cost: CostMetadata) => void
  ): Promise<number>;
  // Runs a single review-gate persona as its own tracked CLI process.
  runPersona(
    workspacePath: string,
    featureName: string,
    persona: PersonaConfig,
    agentConfig: AgentConfig,
    onData?: (text: string) => void,
    onCost?: (cost: CostMetadata) => void
  ): Promise<number>;
  // Runs an on-demand DevOps agent (deploy/monitor/troubleshoot) as its own tracked
  // CLI process. featureName may be null for a workspace-wide run.
  runDevOps(
    workspacePath: string,
    featureName: string | null,
    agent: DevOpsAgent,
    agentConfig: AgentConfig,
    onData?: (text: string) => void,
    onCost?: (cost: CostMetadata) => void
  ): Promise<number>;
  // personaId targets a running persona process; omit it to target the phase process.
  writeStdin(
    phase: WorkflowPhase,
    featureName: string | null,
    text: string,
    personaId?: PersonaId
  ): Promise<boolean>;
  resize(
    phase: WorkflowPhase,
    featureName: string | null,
    cols: number,
    rows: number,
    personaId?: PersonaId
  ): Promise<boolean>;
  stop(
    phase: WorkflowPhase,
    featureName: string | null,
    personaId?: PersonaId
  ): Promise<boolean>;
}
