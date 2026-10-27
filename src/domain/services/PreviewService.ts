import { activeAgent, toAgentConfig } from '../models/agents';
import { PREVIEW_CONFIG_FILE, PreviewConfig, PreviewStatus, parsePreviewConfig } from '../models/preview';
import { CostMetadata } from '../models/types';
import { AgentRepositoryPort } from '../ports/out/AgentRepositoryPort';
import { AgentRunnerPort } from '../ports/out/AgentRunnerPort';
import { ExecutionHistoryPort } from '../ports/out/ExecutionHistoryPort';
import { PreviewRunnerPort } from '../ports/out/PreviewRunnerPort';
import { WorkspaceRepositoryPort } from '../ports/out/WorkspaceRepositoryPort';
import { fixPreviewPrompt, preparePreviewPrompt } from './previewPrompt';

// Preview of the open project next to the board:
//   prepare (agent, once) → .specify/preview.json → start (this app) → the page.
// When the server won't start, "fix" hands its output back to the agent.

export type PreviewView = {
  config: PreviewConfig | null;
  configError?: string; // the file exists but can't be used
  status: PreviewStatus;
};

export type PreviewAgentResult = {
  ok: boolean;
  message: string;
  config?: PreviewConfig;
  cost?: CostMetadata;
};

export class PreviewService {
  constructor(
    private workspaceRepo: WorkspaceRepositoryPort,
    private runner: PreviewRunnerPort,
    private agentRunner: AgentRunnerPort,
    private agents: AgentRepositoryPort,
    private history: ExecutionHistoryPort
  ) {}

  async view(workspacePath: string): Promise<PreviewView> {
    const { config, error } = await this.readConfig(workspacePath);
    return { config, ...(error ? { configError: error } : {}), status: this.runner.status(workspacePath) };
  }

  // The user edits the command by hand (or the agent's result).
  async saveConfig(workspacePath: string, input: unknown): Promise<PreviewConfig> {
    const parsed = parsePreviewConfig(JSON.stringify(input ?? {}));
    if (!parsed.ok) throw new Error(parsed.error);
    await this.workspaceRepo.writeFile(workspacePath, PREVIEW_CONFIG_FILE, JSON.stringify(parsed.value, null, 2) + '\n');
    return parsed.value;
  }

  async start(workspacePath: string): Promise<PreviewStatus> {
    const { config, error } = await this.readConfig(workspacePath);
    if (!config) throw new Error(error ?? 'No preview command yet. Prepare the preview with your agent, or enter the command.');
    return this.runner.start(workspacePath, config);
  }

  stop(workspacePath: string): Promise<void> {
    return this.runner.stop(workspacePath);
  }

  stopAll(): Promise<void> {
    return this.runner.stopAll();
  }

  // The active agent works out how to run the project ("prepare"), or why the
  // last start failed ("fix"), and writes .specify/preview.json.
  async runAgent(
    workspacePath: string,
    mode: 'prepare' | 'fix',
    feature: string | null,
    onData?: (text: string) => void
  ): Promise<PreviewAgentResult> {
    const profile = activeAgent(await this.agents.getAgents(workspacePath));
    if (!profile) return { ok: false, message: 'Select an agent in the Agents section first.' };

    const before = await this.readConfig(workspacePath);
    const status = this.runner.status(workspacePath);
    const prompt = mode === 'fix' && before.config
      ? fixPreviewPrompt(status.command ?? before.config.command, status.logs, status.error)
      : preparePreviewPrompt(feature);
    // Free the port: the agent may start the server briefly to check it.
    await this.runner.stop(workspacePath);

    const label = mode === 'fix' ? 'Fix preview' : 'Prepare preview';
    const record = await this.history.start(workspacePath, {
      kind: 'preview',
      feature,
      label,
      command: `${profile.name}: ${label.toLowerCase()}`,
    });
    const log = (text: string) => {
      this.history.appendLog(workspacePath, record.id, text);
      onData?.(text);
    };

    let cost: CostMetadata | undefined;
    let exitCode = 1;
    try {
      exitCode = await this.agentRunner.runCommand(
        workspacePath,
        { key: `preview-${mode}`, command: '', context: prompt },
        toAgentConfig(profile),
        log,
        c => { cost = c; }
      );
    } catch (err) {
      log(`\n${err instanceof Error ? err.message : String(err)}\n`);
    }

    const after = await this.readConfig(workspacePath);
    const changed = !!after.config && JSON.stringify(after.config) !== JSON.stringify(before.config);
    const ok = !!after.config && (changed || exitCode === 0);
    const message = after.config
      ? `${profile.name} prepared the preview: ${after.config.command}${after.config.notes ? ` — ${after.config.notes}` : ''}`
      : after.error ?? `${profile.name} finished without writing ${PREVIEW_CONFIG_FILE}. See its output above.`;
    log(`\n${ok ? '✓' : '✗'} ${message}\n`);
    await this.history.finish(workspacePath, record.id, { status: ok ? 'passed' : 'failed', exitCode, cost });
    return { ok, message, config: after.config ?? undefined, cost };
  }

  private async readConfig(workspacePath: string): Promise<{ config: PreviewConfig | null; error?: string }> {
    const raw = await this.workspaceRepo.readFile(workspacePath, PREVIEW_CONFIG_FILE);
    if (!raw.trim()) return { config: null };
    const parsed = parsePreviewConfig(raw);
    return parsed.ok ? { config: parsed.value } : { config: null, error: parsed.error };
  }
}
