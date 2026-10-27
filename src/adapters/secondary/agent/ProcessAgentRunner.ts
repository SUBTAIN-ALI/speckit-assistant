import { AgentCommand, AgentRunnerPort } from "../../../domain/ports/out/AgentRunnerPort";
import {
  WorkflowPhase,
  AgentConfig,
  PersonaConfig,
  PersonaId,
  CostMetadata,
} from "../../../domain/models/types";
import { DevOpsAgent } from "../../../domain/models/devopsAgents";
import type * as pty from "node-pty";
import { loadPty } from "../pty/ptyLoader";
import { meter } from "../../../domain/services/CostMeter";
import { ClaudeStreamRenderer, costFromResult } from "./claudeStream";
import * as fs from "fs";
import * as path from "path";

const PHASE_COMMANDS: Record<WorkflowPhase, string> = {
  constitution: "/speckit.constitution",
  specification: "/speckit.specify",
  clarification: "/speckit.clarify",
  planning: "/speckit.plan",
  checklist: "/speckit.checklist",
  analyze: "/speckit.analyze",
  tasks: "/speckit.tasks",
  taskstoissues: "/speckit.taskstoissues",
  implementation: "/speckit.implement",
};

// Extra environment for every agent run, e.g. a fresh Zoom MCP access token
// referenced as ${ZOOM_MEETINGS_MCP_ACCESS_TOKEN} by MCP server headers.
export type AgentEnvProvider = () => Promise<Record<string, string>>;

// How Spec Kit commands are invoked in a workspace. Spec Kit records it in
// .specify/integration.json: older installs (and most agents) use "." —
// "/speckit.specify" — while Spec Kit ≥1.2 with Claude installs skills invoked
// as "/speckit-specify". Commands are authored in the dotted form and adapted.
export function speckitInvocation(workspacePath: string, slash: string): string {
  if (!slash.startsWith("/speckit.")) return slash;
  let sep = ".";
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(workspacePath, ".specify", "integration.json"), "utf-8"));
    const active = cfg?.integration ?? cfg?.default_integration;
    const configured = cfg?.integration_settings?.[active]?.invoke_separator;
    if (typeof configured === "string" && configured) sep = configured;
  } catch {
    // no integration.json (older Spec Kit): keep the dotted form
  }
  return sep === "." ? slash : `/${slash.slice(1).split(".").join(sep)}`;
}

export class ProcessAgentRunner implements AgentRunnerPort {
  // activeProcesses: the live sessions. Pass a shared map to keep them across
  // a fresh runner (e.g. `next dev` reloading this module with new code).
  constructor(
    private envProvider?: AgentEnvProvider,
    private activeProcesses = new Map<string, pty.IPty>()
  ) {}

  private phaseKey(featureName: string | null, phase: WorkflowPhase): string {
    return `${featureName || "global"}-${phase}`;
  }

  private personaKey(featureName: string, id: PersonaId): string {
    return `${featureName}-impl-persona-${id}`;
  }

  private devopsKey(featureName: string | null, id: string): string {
    return `${featureName || "global"}-devops-${id}`;
  }

  async writeStdin(
    phase: WorkflowPhase,
    featureName: string | null,
    text: string,
    personaId?: PersonaId,
  ): Promise<boolean> {
    const procKey =
      personaId && featureName
        ? this.personaKey(featureName, personaId)
        : this.phaseKey(featureName, phase);
    const child = this.activeProcesses.get(procKey);
    if (child) {
      // The frontend xterm sends raw keystrokes (arrow keys, Enter as '\r', etc.)
      // so we forward them verbatim — this is what lets interactive pickers like
      // the clarify Q&A be navigated, not just line-based answers.
      child.write(text);
      return true;
    }
    return false;
  }

  async resize(
    phase: WorkflowPhase,
    featureName: string | null,
    cols: number,
    rows: number,
    personaId?: PersonaId,
  ): Promise<boolean> {
    const procKey =
      personaId && featureName
        ? this.personaKey(featureName, personaId)
        : this.phaseKey(featureName, phase);
    const child = this.activeProcesses.get(procKey);
    if (!child) return false;
    try {
      child.resize(cols, rows);
      return true;
    } catch {
      return false;
    }
  }

  async stop(
    phase: WorkflowPhase,
    featureName: string | null,
    personaId?: PersonaId,
  ): Promise<boolean> {
    const procKey =
      personaId && featureName
        ? this.personaKey(featureName, personaId)
        : this.phaseKey(featureName, phase);
    const child = this.activeProcesses.get(procKey);
    if (child) {
      try {
        child.kill();
        this.activeProcesses.delete(procKey);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  async runPhase(
    workspacePath: string,
    phase: WorkflowPhase,
    featureName: string | null,
    agentConfig: AgentConfig,
    userPrompt?: string,
    onData?: (text: string) => void,
    onCost?: (cost: CostMetadata) => void,
    options?: { instruction?: string },
  ): Promise<number> {
    const specArg =
      phase !== "constitution" && featureName ? `specs/${featureName}` : null;
    const slashCmd = options?.instruction?.trim()
      || `${speckitInvocation(workspacePath, PHASE_COMMANDS[phase])}${specArg ? ` ${specArg}` : ""}`;

    const context = userPrompt?.trim();
    const fullPrompt = context ? `${context}\n\n${slashCmd}` : slashCmd;

    return this.spawnAgent({
      workspacePath,
      procKey: this.phaseKey(featureName, phase),
      feature: phase !== "constitution" ? featureName : null,
      // Clarify is a Q&A with the user (answered via the terminal); every other
      // phase is a one-shot task and must exit when done.
      interactive: phase === "clarification",
      doneTag: phase,
      agentConfig,
      fullPrompt,
      onData,
      onCost,
    });
  }

  async runPersona(
    workspacePath: string,
    featureName: string,
    persona: PersonaConfig,
    agentConfig: AgentConfig,
    onData?: (text: string) => void,
    onCost?: (cost: CostMetadata) => void,
  ): Promise<number> {
    // Personas always operate on a specific feature's artifacts.
    const fullPrompt = `${speckitInvocation(workspacePath, persona.command)} specs/${featureName}`;

    return this.spawnAgent({
      workspacePath,
      procKey: this.personaKey(featureName, persona.id),
      feature: featureName,
      doneTag: `persona:${persona.id}`,
      agentConfig,
      fullPrompt,
      onData,
      onCost,
      persona,
    });
  }

  async runDevOps(
    workspacePath: string,
    featureName: string | null,
    agent: DevOpsAgent,
    agentConfig: AgentConfig,
    onData?: (text: string) => void,
    onCost?: (cost: CostMetadata) => void,
  ): Promise<number> {
    // DevOps agents target a feature's artifacts when one is active, else run
    // workspace-wide. The leading slash mirrors how phases/personas invoke commands.
    const slash = speckitInvocation(workspacePath, agent.command.startsWith("/") ? agent.command : `/${agent.command}`);
    const fullPrompt = featureName ? `${slash} specs/${featureName}` : slash;

    return this.spawnAgent({
      workspacePath,
      procKey: this.devopsKey(featureName, agent.id),
      feature: featureName,
      doneTag: `devops:${agent.id}`,
      agentConfig,
      fullPrompt,
      onData,
      onCost,
      devops: agent,
    });
  }

  async runCommand(
    workspacePath: string,
    command: AgentCommand,
    agentConfig: AgentConfig,
    onData?: (text: string) => void,
    onCost?: (cost: CostMetadata) => void,
  ): Promise<number> {
    const context = command.context?.trim();
    // No slash command: a plain instruction (e.g. preparing the preview).
    const slash = command.command
      ? speckitInvocation(workspacePath, command.command.startsWith("/") ? command.command : `/${command.command}`)
      : "";
    const slashCmd = slash && command.args ? `${slash} ${command.args}` : slash;
    return this.spawnAgent({
      workspacePath,
      procKey: command.key,
      doneTag: `command:${slash || command.key}`,
      agentConfig,
      fullPrompt: [context, slashCmd].filter(Boolean).join("\n\n"),
      onData,
      onCost,
      restricted: command.restricted,
    });
  }

  // Shared spawn path for both phase and persona runs: spawns the agent CLI
  // under a PTY (so interactive CLIs detect a TTY), streams output, and resolves
  // with the exit code.
  private async spawnAgent(opts: {
    workspacePath: string;
    procKey: string;
    doneTag: string;
    agentConfig: AgentConfig;
    fullPrompt: string;
    onData?: (text: string) => void;
    onCost?: (cost: CostMetadata) => void;
    persona?: PersonaConfig;
    devops?: DevOpsAgent;
    restricted?: AgentCommand["restricted"];
    // Feature the run is about. Spec Kit scripts resolve the feature directory
    // from SPECIFY_FEATURE_DIRECTORY first (else the last-specified feature in
    // .specify/feature.json, which is wrong with several features in flight).
    feature?: string | null;
    // Keep the CLI's interactive session open for user input (e.g. clarify).
    // Otherwise Claude runs in print mode so the process exits when finished.
    interactive?: boolean;
  }): Promise<number> {
    const { workspacePath, procKey, doneTag, agentConfig, fullPrompt, onData, onCost } =
      opts;
    const { cmd, args, stdin } = this.buildSpawnArgs(agentConfig, fullPrompt, opts.restricted, opts.interactive);
    // Print-mode Claude streams JSON events; render them as readable log lines.
    const stream = agentConfig.agentType === "claude" && !opts.interactive ? new ClaudeStreamRenderer() : null;
    // Only await when a provider is configured, so runs without one still
    // spawn synchronously (callers may stop/write to the process right away).
    let extraEnv: Record<string, string> = {};
    if (this.envProvider) {
      try {
        extraEnv = (await this.envProvider()) ?? {};
      } catch {
        // optional extras (e.g. Zoom not connected) never block a run
      }
    }

    // Buffer all terminal output and measure wall-clock duration so we can
    // compute a model/CLI-agnostic cost estimate when the process exits.
    let fullOutput = "";
    const startTime = Date.now();

    return new Promise((resolve) => {
      onData?.(`Running: ${cmd} ${args.join(" ")}\n\n`);

      // Spawn the agent under a real pseudo-terminal. This is what makes
      // interactive CLIs (e.g. the clarify Q&A) detect a TTY via isatty() and
      // actually prompt the user instead of running single-shot. We still go
      // through a login shell so PATH/aliases resolve the agent binary the same
      // way they would in the user's own terminal.
      const isWin = process.platform === "win32";
      const ptyFile = isWin
        ? process.env.COMSPEC || "cmd.exe"
        : process.env.SHELL || "/bin/bash";
      const ptyArgs = isWin
        ? ["/c", [cmd, ...args].join(" ")]
        : [
            "-l",
            "-c",
            [cmd, ...args]
              .map((a) => `'${a.replace(/'/g, "'\\''")}'`)
              .join(" "),
          ];

      const child = loadPty().spawn(ptyFile, ptyArgs, {
        name: "xterm-256color",
        cols: 120,
        rows: 30,
        cwd: workspacePath,
        env: {
          ...process.env,
          ...extraEnv,
          ...(opts.feature
            ? { SPECIFY_FEATURE_DIRECTORY: `specs/${opts.feature}`, SPECIFY_FEATURE: opts.feature }
            : {}),
          TERM: "xterm-256color",
          ...(opts.persona
            ? {
                SPECKIT_PERSONA_ID: opts.persona.id || "",
                SPECKIT_PERSONA_LABEL: opts.persona.label || "",
                SPECKIT_PERSONA_MODEL: opts.persona.model || "",
                SPECKIT_PERSONA_SYSTEM_PROMPT: opts.persona.systemPrompt || "",
                SPECKIT_PERSONA_CAPABILITIES: Array.isArray(
                  opts.persona.capabilities,
                )
                  ? opts.persona.capabilities.join(",")
                  : "",
                SPECKIT_PERSONA_TOOLS: Array.isArray(opts.persona.tools)
                  ? opts.persona.tools.join(",")
                  : "",
              }
            : {}),
          ...(opts.devops
            ? {
                SPECKIT_DEVOPS_ID: opts.devops.id || "",
                SPECKIT_DEVOPS_LABEL: opts.devops.label || "",
                SPECKIT_DEVOPS_CATEGORY: opts.devops.category || "",
                SPECKIT_DEVOPS_MODEL: opts.devops.model || "",
                SPECKIT_DEVOPS_SYSTEM_PROMPT: opts.devops.systemPrompt || "",
              }
            : {}),
        } as { [key: string]: string },
      });

      this.activeProcesses.set(procKey, child);

      // For agents that receive their prompt over stdin, feed it now and send
      // EOF (Ctrl-D) so the single-shot CLI starts processing. Agents that take
      // the prompt as an argument keep the channel open so the user can answer
      // interactive prompts (e.g. clarify) through writeStdin().
      if (stdin !== undefined) {
        child.write(stdin);
        child.write("\x04");
      }

      child.onData((data: string) => {
        fullOutput += data;
        if (!stream) return onData?.(data);
        const text = stream.push(data);
        if (text) onData?.(text);
      });

      child.onExit(({ exitCode }: { exitCode: number }) => {
        this.activeProcesses.delete(procKey);
        const rest = stream?.flush();
        if (rest) onData?.(rest);
        onData?.(`\nProcess exited with code ${exitCode}\n`);

        // Cost/usage: exact when Claude reported it, else the agnostic estimate.
        try {
          onCost?.(
            stream?.result
              ? costFromResult(stream.result)
              : meter({
                  agentType: agentConfig.agentType,
                  model: opts.persona?.model ?? opts.devops?.model ?? agentConfig.model,
                  promptText: fullPrompt,
                  outputText: fullOutput,
                  durationMs: Date.now() - startTime,
                }),
          );
        } catch {
          // cost capture is best-effort; never block the run on it
        }

        // Write the phase done file so local watch logs it
        try {
          const runtimeDir = path.join(workspacePath, ".specify", ".runtime");
          if (!fs.existsSync(runtimeDir)) {
            fs.mkdirSync(runtimeDir, { recursive: true });
          }
          fs.writeFileSync(
            path.join(runtimeDir, "phase-done.txt"),
            `${doneTag}:${exitCode}`,
            "utf-8",
          );
        } catch {
          // ignore
        }

        resolve(exitCode);
      });
    });
  }

  private buildSpawnArgs(
    config: AgentConfig,
    prompt: string,
    restricted?: AgentCommand["restricted"],
    interactive?: boolean,
  ): { cmd: string; args: string[]; stdin?: string } {
    const agentType = config.agentType;
    const cliPath = config.agentPath || this.getDefaultCli(agentType);

    // Unattended, least-privilege run: print mode (no TTY prompts, no first-run
    // bypass confirmation), "dontAsk" denies anything not allow-listed, and only
    // the given MCP servers are loaded.
    if (agentType === "claude" && restricted) {
      const servers = Object.keys(restricted.mcpServers).length
        ? ["--mcp-config", JSON.stringify({ mcpServers: restricted.mcpServers })]
        : [];
      return {
        cmd: cliPath,
        args: [
          "-p",
          "--output-format", "stream-json", "--verbose",
          "--permission-mode", "dontAsk",
          "--strict-mcp-config",
          ...servers,
          "--allowedTools", ...restricted.allowedTools,
          "--",
          prompt,
        ],
      };
    }

    switch (agentType) {
      case "claude":
        return {
          cmd: cliPath,
          // Interactive sessions never exit on their own; one-shot runs use
          // print mode (exits when done) with a JSON event stream for live logs.
          args: interactive
            ? ["--permission-mode", "bypassPermissions", prompt]
            : ["-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "bypassPermissions", "--", prompt],
        };
      case "gemini":
        return {
          cmd: cliPath,
          args: [],
          stdin: prompt,
        };
      case "copilot":
        return {
          cmd: cliPath,
          args: [prompt],
        };
      case "openai":
        return {
          cmd: cliPath,
          args: ["exec", "-"],
          stdin: prompt,
        };
      case "custom":
        if (config.customCommand) {
          const parts = config.customCommand.split(" ");
          const cmd = parts[0];
          const args = parts
            .slice(1)
            .map((arg) => (arg === "{{prompt}}" ? prompt : arg));
          // If {{prompt}} isn't in args, append it
          if (!config.customCommand.includes("{{prompt}}")) {
            args.push(prompt);
          }
          return { cmd, args };
        }
        return { cmd: "specify", args: [prompt] };
      default:
        return { cmd: cliPath, args: [prompt] };
    }
  }

  private getDefaultCli(agentType: string): string {
    const defaults: Record<string, string> = {
      claude: "claude",
      gemini: "gemini",
      copilot: "ghcs",
      openai: "codex",
    };
    return defaults[agentType] || "specify";
  }
}
