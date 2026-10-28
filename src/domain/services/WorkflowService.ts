import { WorkflowUseCases } from '../ports/in/WorkflowUseCases';
import { WorkspaceRepositoryPort } from '../ports/out/WorkspaceRepositoryPort';
import { AgentRunnerPort } from '../ports/out/AgentRunnerPort';
import { ExecutionHistoryPort } from '../ports/out/ExecutionHistoryPort';
import { ExtensionRepositoryPort } from '../ports/out/ExtensionRepositoryPort';
import {
  WorkflowState,
  WorkflowPhase,
  AgentConfig,
  FeatureWorkflow,
  PhaseState,
  PersonaConfig,
  PersonaId,
  PersonaRunStatus,
  CostMetadata,
  isPhaseDone,
} from '../models/types';
import { ExecutionStartInput, ExecutionStatus } from '../models/executions';
import { DevOpsAgent } from '../models/devopsAgents';
import { orderPersonas, personaReportPath } from '../models/personas';
import { BUNDLED_EXTENSIONS, InstalledExtension } from '../models/extensions';
import { quickBuildContext, quickBuildInstruction } from './implementPrompt';
import { extractFixSuggestion } from './fixExtraction';
import { appendPatchNote, patchNotesPath } from './patchNotes';

const FEATURE_PHASES: WorkflowPhase[] = [
  'specification',
  'clarification',
  'planning',
  'checklist',
  'analyze',
  'tasks',
  'taskstoissues',
  'implementation'
];

export class WorkflowService implements WorkflowUseCases {
  constructor(
    private workspaceRepo: WorkspaceRepositoryPort,
    private agentRunner: AgentRunnerPort,
    private executionHistory: ExecutionHistoryPort,
    // Lets the review gate check its personas' commands are installed before
    // spending a run on them. Without it, the gate doesn't check.
    private extensions?: ExtensionRepositoryPort
  ) {}

  // Wraps an agent run with execution-history tracking: records a 'running' entry,
  // tees the run's output to its log file, then persists the terminal status/exit/cost.
  // Returns the exit code, captured cost, and resolved status.
  private async recordRun(
    workspacePath: string,
    meta: ExecutionStartInput,
    onData: ((text: string) => void) | undefined,
    run: (onData: (text: string) => void, onCost: (cost: CostMetadata) => void) => Promise<number>,
    resolveStatus?: (exitCode: number) => Promise<ExecutionStatus> | ExecutionStatus
  ): Promise<{ exitCode: number; cost?: CostMetadata; status: ExecutionStatus }> {
    const record = await this.executionHistory.start(workspacePath, meta);
    const tee = (text: string) => {
      this.executionHistory.appendLog(workspacePath, record.id, text);
      onData?.(text);
    };
    let cost: CostMetadata | undefined;
    let exitCode = 1;
    try {
      exitCode = await run(tee, (c) => { cost = c; });
      const status: ExecutionStatus = resolveStatus
        ? await resolveStatus(exitCode)
        : exitCode === 0 ? 'passed' : 'failed';
      await this.executionHistory.finish(workspacePath, record.id, { status, exitCode, cost });
      return { exitCode, cost, status };
    } catch (err) {
      await this.executionHistory.finish(workspacePath, record.id, { status: 'failed', exitCode, cost });
      throw err;
    }
  }

  async getWorkflowState(workspacePath: string): Promise<WorkflowState> {
    const state = await this.workspaceRepo.getWorkflowState(workspacePath);
    return state;
  }

  async createFeature(workspacePath: string, name: string): Promise<WorkflowState> {
    const state = await this.workspaceRepo.createFeature(workspacePath, name);
    state.activeFeatureName = name;
    await this.workspaceRepo.saveWorkflowState(workspacePath, state);
    return state;
  }

  async deleteFeature(workspacePath: string, name: string): Promise<WorkflowState> {
    const state = await this.workspaceRepo.deleteFeature(workspacePath, name);
    return state;
  }

  async setActiveFeature(workspacePath: string, name: string): Promise<WorkflowState> {
    const state = await this.workspaceRepo.getWorkflowState(workspacePath);
    if (state.features.some(f => f.name === name)) {
      state.activeFeatureName = name;
      await this.workspaceRepo.saveWorkflowState(workspacePath, state);
    }
    return state;
  }

  async runPhase(
    workspacePath: string,
    phase: WorkflowPhase,
    featureName: string | null,
    agentConfig: AgentConfig,
    userPrompt?: string,
    onData?: (text: string) => void,
    personas?: PersonaConfig[],
    // instruction: replaces the phase's slash command (quick build without tasks.md).
    runOptions?: { instruction?: string }
  ): Promise<WorkflowState> {
    const state = await this.workspaceRepo.getWorkflowState(workspacePath);
    const targetFeature = featureName || state.activeFeatureName;

    // Set status to running
    this.setPhaseStatus(state, phase, targetFeature, 'running');
    const startingPhase = this.findPhase(state, phase, targetFeature);
    if (startingPhase) delete startingPhase.attention;
    await this.workspaceRepo.saveWorkflowState(workspacePath, state);
    const tasksBefore = taskProgress(state, targetFeature);
    // The run's last words, to show a question it stopped on.
    let tail = '';
    // Interactive clarification: auto-finish when the agent prints its
    // completion report so the card moves to awaiting_review without the
    // user having to click Finish manually.
    let autoFinished = false;
    const capture = (text: string) => {
      tail = (tail + text).slice(-8000);
      onData?.(text);
      if (phase === 'clarification' && !autoFinished && /Completion Report/i.test(tail)) {
        autoFinished = true;
        this.finishPhase(workspacePath, phase, targetFeature).catch(() => {});
      }
    };

    try {
      const { exitCode, cost: runCost } = await this.recordRun(
        workspacePath,
        { kind: 'phase', feature: targetFeature, phase, label: phase },
        capture,
        (d, c) => this.agentRunner.runPhase(workspacePath, phase, targetFeature, agentConfig, userPrompt, d, c, runOptions)
      );

      // Re-read state in case files changed on disk during run
      const freshState = await this.workspaceRepo.getWorkflowState(workspacePath);
      const runPhaseState = this.findPhase(freshState, phase, targetFeature);
      if (runPhaseState && runCost) runPhaseState.cost = runCost;

      // The user approved or discarded the phase while it was still running
      // (e.g. an interactive Clarify session, which never exits on its own):
      // their decision stands.
      if (runPhaseState && runPhaseState.status !== 'running') {
        await this.workspaceRepo.saveWorkflowState(workspacePath, freshState);
        return freshState;
      }

      if (exitCode !== 0) {
        this.setPhaseStatus(freshState, phase, targetFeature, 'idle');
        await this.workspaceRepo.saveWorkflowState(workspacePath, freshState);
        return freshState;
      }

      // Implement can end cleanly without building anything — it stopped to ask
      // something (e.g. "proceed although a checklist is incomplete?") that a
      // non-interactive run can't answer, or Spec Kit's prerequisites (plan.md,
      // tasks.md) are missing. Progress on tasks.md during this run is the
      // evidence that it built something; without it, don't call it done.
      if (phase === 'implementation' && runPhaseState) {
        const message = implementationShortfall(tasksBefore, taskProgress(freshState, targetFeature), targetFeature, !!runOptions?.instruction);
        if (message) {
          runPhaseState.status = 'idle';
          runPhaseState.attention = {
            message,
            ...(lastQuestion(tail) ? { question: lastQuestion(tail) } : {}),
          };
          await this.workspaceRepo.saveWorkflowState(workspacePath, freshState);
          return freshState;
        }
      }

      // Implementation: if a review gate is configured, the personas govern the
      // final status (only reaching awaiting_review after Tech Lead signs off).
      const enabledPersonas = (personas ?? []).filter(p => p.enabled);
      if (phase === 'implementation' && targetFeature && enabledPersonas.length > 0) {
        this.setPhaseStatus(freshState, phase, targetFeature, 'running');
        await this.workspaceRepo.saveWorkflowState(workspacePath, freshState);
        return this.runImplementationGate(workspacePath, targetFeature, agentConfig, personas!, onData);
      }

      this.setPhaseStatus(freshState, phase, targetFeature, 'awaiting_review');
      // Check if tasks are completed to auto-complete implementation
      if (phase === 'implementation') {
        await this.checkImplementationAutoReview(workspacePath, freshState, targetFeature);
      }

      await this.workspaceRepo.saveWorkflowState(workspacePath, freshState);
      return freshState;
    } catch (err) {
      const freshState = await this.workspaceRepo.getWorkflowState(workspacePath);
      if (this.findPhase(freshState, phase, targetFeature)?.status !== 'running') throw err; // user already decided
      this.setPhaseStatus(freshState, phase, targetFeature, 'idle');
      await this.workspaceRepo.saveWorkflowState(workspacePath, freshState);
      throw err;
    }
  }

  // Runs the implementation review gate: enabled personas execute sequentially
  // (Tech Lead last). The gate stops at the first persona that fails, leaving
  // the implementation phase 'running' (blocked). Only when every persona passes
  // does the phase advance to 'awaiting_review' for human approval.
  async runImplementationGate(
    workspacePath: string,
    featureName: string,
    agentConfig: AgentConfig,
    personas: PersonaConfig[],
    onData?: (text: string) => void
  ): Promise<WorkflowState> {
    const enabled = orderPersonas(personas.filter(p => p.enabled));

    const state = await this.workspaceRepo.getWorkflowState(workspacePath);
    const implPhase = this.findPhase(state, 'implementation', featureName);
    if (!implPhase) return state;

    implPhase.status = 'running';
    implPhase.personas = enabled.map(p => ({
      id: p.id,
      status: 'idle' as PersonaRunStatus,
      reportPath: personaReportPath(featureName, p.id),
    }));

    // A persona whose command isn't installed can't review anything: the agent
    // improvises instead, records no verdict, and that reads as a rejection.
    // Block the gate as a setup problem before running anyone.
    const missing = await this.missingPersonaCommands(workspacePath, enabled);
    if (missing.size > 0) {
      for (const ps of implPhase.personas) {
        const note = missing.get(ps.id);
        if (!note) continue;
        ps.status = 'unavailable';
        ps.reportPath = null;
        ps.note = note;
        onData?.(`\r\n\x1b[33m⚠ ${note}\x1b[0m\r\n`);
      }
      await this.workspaceRepo.saveWorkflowState(workspacePath, state);
      return state;
    }
    await this.workspaceRepo.saveWorkflowState(workspacePath, state);

    for (const persona of enabled) {
      const ps = implPhase.personas!.find(x => x.id === persona.id)!;
      ps.status = 'running';
      await this.workspaceRepo.saveWorkflowState(workspacePath, state);

      onData?.(`\r\n\x1b[36m=== Persona: ${persona.label} (${persona.command}) ===\x1b[0m\r\n`);

      let output = '';
      let found: PersonaVerdict | undefined;
      const { cost: personaCost, status } = await this.recordRun(
        workspacePath,
        { kind: 'persona', feature: featureName, phase: 'implementation', agentId: persona.id, label: persona.label, command: persona.command },
        text => { output = (output + text).slice(-20000); onData?.(text); },
        (d, c) => this.agentRunner.runPersona(workspacePath, featureName, persona, agentConfig, d, c),
        async () => (found = await this.resolvePersonaVerdict(workspacePath, featureName, persona.id, output)).status as ExecutionStatus
      );

      const verdict = status as PersonaRunStatus;
      ps.status = verdict;
      if (found?.reportPath) ps.reportPath = found.reportPath;
      if (found?.note) ps.note = found.note;
      if (found?.failureSummary) ps.failureSummary = found.failureSummary;
      if (found?.suggestedFix) ps.suggestedFix = found.suggestedFix;
      if (personaCost) ps.cost = personaCost;
      await this.workspaceRepo.saveWorkflowState(workspacePath, state);

      if (verdict === 'failed') {
        onData?.(`\r\n\x1b[31m✗ ${persona.label} bloqueou o gate — implementação permanece em revisão.\x1b[0m\r\n`);
        return state;
      }
      onData?.(`\r\n\x1b[32m✓ ${persona.label} passou.\x1b[0m\r\n`);
    }

    implPhase.status = 'awaiting_review';
    await this.workspaceRepo.saveWorkflowState(workspacePath, state);
    onData?.(`\r\n\x1b[32m✓ Review gate completo — pronto para aprovação.\x1b[0m\r\n`);
    return state;
  }

  // Targeted fix after a review persona failed: writes a patch note, runs a
  // lightweight fix agent (review report + instruction only), re-reviews with
  // just the failed persona, then continues the gate from that point.
  async runFix(
    workspacePath: string,
    featureName: string,
    failedPersonaId: PersonaId,
    fixInstruction: string,
    agentConfig: AgentConfig,
    personas: PersonaConfig[],
    onData?: (text: string) => void
  ): Promise<WorkflowState> {
    const state = await this.workspaceRepo.getWorkflowState(workspacePath);
    const implPhase = this.findPhase(state, 'implementation', featureName);
    if (!implPhase?.personas) throw new Error('No implementation gate state found.');

    const failedPs = implPhase.personas.find(p => p.id === failedPersonaId);
    if (!failedPs || failedPs.status !== 'failed') {
      throw new Error(`Persona '${failedPersonaId}' is not in a failed state.`);
    }

    const personaConfig = personas.find(p => p.id === failedPersonaId);
    if (!personaConfig) throw new Error(`No config for persona '${failedPersonaId}'.`);

    // 1. Write patch note
    const readFile = (p: string) => this.workspaceRepo.readFile(workspacePath, p);
    const writeFileAdapter = async (p: string, c: string) => { await this.workspaceRepo.writeFile(workspacePath, p, c); };
    await appendPatchNote(readFile, writeFileAdapter, featureName, {
      personaId: failedPersonaId,
      personaLabel: personaConfig.label,
      fixInstruction,
      timestamp: new Date().toISOString(),
    });

    // 2. Build minimal fix prompt from the review report + instruction
    let reviewReport = '';
    if (failedPs.reportPath) {
      try { reviewReport = await this.workspaceRepo.readFile(workspacePath, failedPs.reportPath); } catch { /* */ }
    }
    let patchNotes = '';
    try { patchNotes = await readFile(patchNotesPath(featureName)); } catch { /* */ }

    const fixPrompt = [
      `You are fixing a review failure in specs/${featureName}/.`,
      '',
      '## Review Report',
      reviewReport || '(no report available)',
      '',
      '## Fix Instruction',
      fixInstruction,
      '',
      patchNotes ? `## Patch Notes\n${patchNotes}` : '',
      '',
      'Apply ONLY the fix described above. Do not re-implement the full feature.',
      'Read the review report, understand the blocking findings, and make targeted changes to resolve them.',
      'After applying the fix, verify it addresses the blocking findings.',
    ].filter(Boolean).join('\n');

    // 3. Run the fix agent
    failedPs.status = 'running';
    delete failedPs.failureSummary;
    delete failedPs.suggestedFix;
    implPhase.status = 'running';
    await this.workspaceRepo.saveWorkflowState(workspacePath, state);

    onData?.(`\r\n\x1b[36m=== Fix: applying fix for ${personaConfig.label} ===\x1b[0m\r\n`);

    try {
      await this.recordRun(
        workspacePath,
        { kind: 'fix', feature: featureName, phase: 'implementation', agentId: failedPersonaId, label: `Fix: ${personaConfig.label}` },
        text => onData?.(text),
        (d, c) => this.agentRunner.runPhase(workspacePath, 'implementation', featureName, agentConfig, undefined, d, c, { instruction: fixPrompt })
      );
    } catch (err) {
      failedPs.status = 'failed';
      await this.workspaceRepo.saveWorkflowState(workspacePath, state);
      throw err;
    }

    // 4. Scoped re-review: only the failed persona
    onData?.(`\r\n\x1b[36m=== Re-reviewing: ${personaConfig.label} ===\x1b[0m\r\n`);
    failedPs.status = 'running';
    await this.workspaceRepo.saveWorkflowState(workspacePath, state);

    let output = '';
    let found: PersonaVerdict | undefined;
    const { cost: personaCost, status: reviewStatus } = await this.recordRun(
      workspacePath,
      { kind: 'persona', feature: featureName, phase: 'implementation', agentId: failedPersonaId, label: personaConfig.label, command: personaConfig.command },
      text => { output = (output + text).slice(-20000); onData?.(text); },
      (d, c) => this.agentRunner.runPersona(workspacePath, featureName, personaConfig, agentConfig, d, c),
      async () => (found = await this.resolvePersonaVerdict(workspacePath, featureName, failedPersonaId, output)).status as ExecutionStatus
    );

    const verdict = reviewStatus as PersonaRunStatus;
    failedPs.status = verdict;
    if (found?.reportPath) failedPs.reportPath = found.reportPath;
    if (found?.note) failedPs.note = found.note;
    if (found?.failureSummary) failedPs.failureSummary = found.failureSummary;
    if (found?.suggestedFix) failedPs.suggestedFix = found.suggestedFix;
    if (personaCost) failedPs.cost = personaCost;
    await this.workspaceRepo.saveWorkflowState(workspacePath, state);

    if (verdict === 'failed') {
      onData?.(`\r\n\x1b[31m✗ ${personaConfig.label} still failed after fix.\x1b[0m\r\n`);
      return state;
    }
    onData?.(`\r\n\x1b[32m✓ ${personaConfig.label} passed after fix.\x1b[0m\r\n`);

    // 5. Continue the gate: run remaining personas after the one that just passed
    const enabled = orderPersonas(personas.filter(p => p.enabled));
    const passedIdx = enabled.findIndex(p => p.id === failedPersonaId);
    const remaining = enabled.slice(passedIdx + 1);

    for (const persona of remaining) {
      const ps = implPhase.personas!.find(x => x.id === persona.id)!;
      ps.status = 'running';
      await this.workspaceRepo.saveWorkflowState(workspacePath, state);

      onData?.(`\r\n\x1b[36m=== Persona: ${persona.label} (${persona.command}) ===\x1b[0m\r\n`);

      let pOutput = '';
      let pFound: PersonaVerdict | undefined;
      const { cost: pCost, status: pStatus } = await this.recordRun(
        workspacePath,
        { kind: 'persona', feature: featureName, phase: 'implementation', agentId: persona.id, label: persona.label, command: persona.command },
        text => { pOutput = (pOutput + text).slice(-20000); onData?.(text); },
        (d, c) => this.agentRunner.runPersona(workspacePath, featureName, persona, agentConfig, d, c),
        async () => (pFound = await this.resolvePersonaVerdict(workspacePath, featureName, persona.id, pOutput)).status as ExecutionStatus
      );

      const pVerdict = pStatus as PersonaRunStatus;
      ps.status = pVerdict;
      if (pFound?.reportPath) ps.reportPath = pFound.reportPath;
      if (pFound?.note) ps.note = pFound.note;
      if (pFound?.failureSummary) ps.failureSummary = pFound.failureSummary;
      if (pFound?.suggestedFix) ps.suggestedFix = pFound.suggestedFix;
      if (pCost) ps.cost = pCost;
      await this.workspaceRepo.saveWorkflowState(workspacePath, state);

      if (pVerdict === 'failed') {
        onData?.(`\r\n\x1b[31m✗ ${persona.label} blocked the gate.\x1b[0m\r\n`);
        return state;
      }
      onData?.(`\r\n\x1b[32m✓ ${persona.label} passed.\x1b[0m\r\n`);
    }

    implPhase.status = 'awaiting_review';
    await this.workspaceRepo.saveWorkflowState(workspacePath, state);
    onData?.(`\r\n\x1b[32m✓ Review gate complete — ready for approval.\x1b[0m\r\n`);
    return state;
  }

  // Runs an on-demand DevOps agent (deploy/monitor/troubleshoot). It does not change
  // workflow/phase state — it's an operational action, fully tracked in the execution
  // history. featureName may be null for a workspace-wide run.
  async runDevOps(
    workspacePath: string,
    agent: DevOpsAgent,
    featureName: string | null,
    agentConfig: AgentConfig,
    onData?: (text: string) => void
  ): Promise<{ exitCode: number }> {
    const { exitCode } = await this.recordRun(
      workspacePath,
      { kind: 'devops', feature: featureName, agentId: agent.id, label: agent.label, command: agent.command },
      onData,
      (d, c) => this.agentRunner.runDevOps(workspacePath, featureName, agent, agentConfig, d, c)
    );
    return { exitCode };
  }

  // Personas whose extension command (/speckit.<extension>.<name>) no enabled,
  // installed extension provides, with what to do about it. Core Spec Kit and
  // custom (non-speckit) commands aren't checked: nothing here says where they live.
  private async missingPersonaCommands(workspacePath: string, personas: PersonaConfig[]): Promise<Map<PersonaId, string>> {
    const missing = new Map<PersonaId, string>();
    if (!this.extensions) return missing;
    let installed: InstalledExtension[];
    try {
      installed = await this.extensions.listInstalled(workspacePath);
    } catch {
      return missing; // can't tell: let the run decide
    }
    for (const persona of personas) {
      const name = persona.command.replace(/^\//, '');
      const ns = /^speckit\.([^.]+)\.[^.]+$/.exec(name)?.[1];
      if (!ns) continue;
      const providers = installed.filter(e => e.commands.includes(name));
      if (providers.some(e => e.enabled)) continue;
      const ext = BUNDLED_EXTENSIONS.find(b => b.id === ns);
      const extName = ext ? `“${ext.label}”` : `the “${ns}” extension`;
      missing.set(persona.id, providers.length > 0
        ? `${persona.label} can't run: ${extName} is disabled in this workspace, so ${persona.command} isn't available. Enable it in the Extensions section, then re-run the review.`
        : `${persona.label} can't run: ${persona.command} isn't installed in this workspace. Install ${extName} from the Extensions section, then re-run the review.`);
    }
    return missing;
  }

  // A persona's verdict is its explicit "VERDICT: PASS|FAIL", from its report —
  // specs/<feature>/reviews/<id>.md, or where agents also write it
  // (<id>-report.md) — or else its final output. No verdict is a fail: a clean
  // exit says nothing about the code (reviewers have "passed" features that had
  // no code at all).
  private async resolvePersonaVerdict(
    workspacePath: string,
    featureName: string,
    id: PersonaId,
    output: string
  ): Promise<PersonaVerdict> {
    const compact = id.replace(/-/g, '');
    const candidates = [...new Set([
      personaReportPath(featureName, id),
      `specs/${featureName}/reviews/${id}-report.md`,
      `specs/${featureName}/${id}-report.md`,
      `specs/${featureName}/${compact}-report.md`,
    ])];
    let reportPath: string | undefined;
    let reportText = '';
    for (const file of candidates) {
      let report = '';
      try {
        report = await this.workspaceRepo.readFile(workspacePath, file);
      } catch {
        report = '';
      }
      if (!report.trim()) continue;
      reportPath ??= file;
      if (!reportText) reportText = report;
      const v = verdictIn(report);
      if (v) {
        const fix = v === 'failed' ? extractFixSuggestion(report) : undefined;
        return { status: v, reportPath: file, ...fix };
      }
    }
    const fromOutput = verdictIn(output);
    if (fromOutput) {
      const fix = fromOutput === 'failed' ? extractFixSuggestion(reportText || output) : undefined;
      return { status: fromOutput, reportPath, ...fix };
    }
    const fix = extractFixSuggestion(reportText || output);
    return { status: 'failed', reportPath, note: 'No verdict recorded (expected “VERDICT: PASS” or “VERDICT: FAIL”), so it counts as a fail. Read the report and re-run the review.', ...fix };
  }

  async approvePhase(workspacePath: string, phase: WorkflowPhase, featureName: string | null): Promise<WorkflowState> {
    const state = await this.workspaceRepo.getWorkflowState(workspacePath);
    const targetFeature = featureName || state.activeFeatureName;

    const ps = this.findPhase(state, phase, targetFeature);
    if (ps) {
      ps.status = 'approved';
      ps.stale = false;
      delete ps.attention;
    }

    await this.workspaceRepo.saveWorkflowState(workspacePath, state);
    // Moving the card on ends a session still open for it (Clarify stays at its prompt).
    await this.agentRunner.stop(phase, targetFeature);
    return state;
  }

  // Quick build (from the Specification card): approve the spec, mark the
  // phases in between as skipped, and implement straight away. The agent works
  // out the feature and the existing project itself; with no tasks.md it writes
  // one first (Spec Kit's format), so progress and the review gate still work.
  async quickBuild(
    workspacePath: string,
    featureName: string,
    agentConfig: AgentConfig,
    personas?: PersonaConfig[],
    onData?: (text: string) => void
  ): Promise<WorkflowState> {
    const state = await this.workspaceRepo.getWorkflowState(workspacePath);
    const feature = state.features.find(f => f.name === featureName);
    if (!feature) throw new Error(`Feature ${featureName} not found.`);
    const spec = feature.phases.find(p => p.phase === 'specification');
    if (!spec?.filePath) throw new Error('Write the spec first: a quick build implements specs/<feature>/spec.md.');
    if (feature.phases.some(p => p.status === 'running')) throw new Error('An agent is already running on this feature.');

    spec.status = 'approved';
    spec.stale = false;
    for (const p of feature.phases) {
      if (p.phase !== 'specification' && p.phase !== 'implementation' && !isPhaseDone(p.status)) p.status = 'skipped';
    }
    const impl = feature.phases.find(p => p.phase === 'implementation')!;
    impl.quickBuild = true;
    await this.workspaceRepo.saveWorkflowState(workspacePath, state);

    const hasTasks = !!feature.phases.find(p => p.phase === 'tasks')?.filePath;
    return hasTasks
      ? this.runPhase(workspacePath, 'implementation', featureName, agentConfig, quickBuildContext(), onData, personas)
      : this.runPhase(workspacePath, 'implementation', featureName, agentConfig, undefined, onData, personas, { instruction: quickBuildInstruction(featureName) });
  }

  // Ends an interactive phase the user is done with (Clarify stays at its prompt
  // after it finishes): the phase goes to review and its session is closed.
  async finishPhase(workspacePath: string, phase: WorkflowPhase, featureName: string | null): Promise<WorkflowState> {
    const state = await this.workspaceRepo.getWorkflowState(workspacePath);
    const targetFeature = featureName || state.activeFeatureName;
    const ps = this.findPhase(state, phase, targetFeature);
    if (ps && ps.status === 'running') {
      ps.status = 'awaiting_review';
      await this.workspaceRepo.saveWorkflowState(workspacePath, state);
    }
    await this.agentRunner.stop(phase, targetFeature);
    return state;
  }

  async discardPhase(workspacePath: string, phase: WorkflowPhase, featureName: string | null): Promise<WorkflowState> {
    const state = await this.workspaceRepo.getWorkflowState(workspacePath);
    const targetFeature = featureName || state.activeFeatureName;

    const ps = this.findPhase(state, phase, targetFeature);
    if (ps) {
      ps.status = 'idle';
      ps.content = null;
      ps.stale = false;
      delete ps.attention;
    }

    this.markDownstreamStale(state, phase, targetFeature);
    await this.workspaceRepo.saveWorkflowState(workspacePath, state);
    await this.agentRunner.stop(phase, targetFeature);
    return state;
  }

  // Ticks a checkbox in whichever Markdown file is open (tasks.md, a checklist…).
  async toggleCheckbox(workspacePath: string, filePath: string, lineIndex: number, checked: boolean): Promise<WorkflowState> {
    await this.workspaceRepo.toggleCheckbox(workspacePath, filePath, lineIndex, checked);
    const state = await this.workspaceRepo.getWorkflowState(workspacePath);
    // Ticking tasks can complete the implementation.
    const feature = state.features.find(f => f.phases.some(p => p.phase === 'tasks' && p.filePath && samePath(p.filePath, workspacePath, filePath)));
    if (feature) {
      await this.checkImplementationAutoReview(workspacePath, state, feature.name);
      await this.workspaceRepo.saveWorkflowState(workspacePath, state);
    }
    return state;
  }

  async toggleTask(workspacePath: string, featureName: string, lineIndex: number, checked: boolean): Promise<WorkflowState> {
    const freshState = await this.workspaceRepo.toggleTask(workspacePath, featureName, lineIndex, checked);
    await this.checkImplementationAutoReview(workspacePath, freshState, featureName);
    await this.workspaceRepo.saveWorkflowState(workspacePath, freshState);
    return freshState;
  }

  async readFile(workspacePath: string, filePath: string): Promise<string> {
    return this.workspaceRepo.readFile(workspacePath, filePath);
  }

  async writeFile(workspacePath: string, filePath: string, content: string): Promise<WorkflowState> {
    await this.workspaceRepo.writeFile(workspacePath, filePath, content);
    
    // Determine which phase/feature this file belongs to and update status to awaiting_review if not approved
    const state = await this.workspaceRepo.getWorkflowState(workspacePath);
    await this.workspaceRepo.saveWorkflowState(workspacePath, state);
    return state;
  }

  // Flags a feature phase and the approved phases after it as out of date —
  // e.g. when the requirements a spec was generated from change. No-op for a
  // phase that hasn't produced anything yet.
  async markStale(workspacePath: string, phase: WorkflowPhase, featureName: string): Promise<WorkflowState> {
    const state = await this.workspaceRepo.getWorkflowState(workspacePath);
    const ps = this.findPhase(state, phase, featureName);
    if (ps && ps.status !== 'idle') {
      ps.stale = true;
      this.markDownstreamStale(state, phase, featureName);
      await this.workspaceRepo.saveWorkflowState(workspacePath, state);
    }
    return state;
  }

  async writeStdin(phase: WorkflowPhase, featureName: string | null, text: string, personaId?: PersonaId): Promise<boolean> {
    return this.agentRunner.writeStdin(phase, featureName, text, personaId);
  }

  async resize(phase: WorkflowPhase, featureName: string | null, cols: number, rows: number, personaId?: PersonaId): Promise<boolean> {
    return this.agentRunner.resize(phase, featureName, cols, rows, personaId);
  }

  async stop(phase: WorkflowPhase, featureName: string | null, personaId?: PersonaId): Promise<boolean> {
    return this.agentRunner.stop(phase, featureName, personaId);
  }

  // Helper methods
  private findPhase(state: WorkflowState, phase: WorkflowPhase, featureName: string | null): PhaseState | null {
    if (phase === 'constitution') {
      return state.constitutionPhase;
    }
    const feature = state.features.find(f => f.name === featureName);
    if (!feature) return null;
    return feature.phases.find(p => p.phase === phase) || null;
  }

  private setPhaseStatus(state: WorkflowState, phase: WorkflowPhase, featureName: string | null, status: any) {
    const ps = this.findPhase(state, phase, featureName);
    if (ps) {
      ps.status = status;
    }
  }

  private markDownstreamStale(state: WorkflowState, discarded: WorkflowPhase, featureName: string | null) {
    if (discarded === 'constitution') {
      for (const feature of state.features) {
        for (const p of feature.phases) {
          if (p.status === 'approved') p.stale = true;
        }
      }
      return;
    }

    const feature = state.features.find(f => f.name === featureName);
    if (!feature) return;

    const idx = FEATURE_PHASES.indexOf(discarded);
    if (idx === -1) return;

    for (let i = idx + 1; i < FEATURE_PHASES.length; i++) {
      const later = feature.phases.find(p => p.phase === FEATURE_PHASES[i]);
      if (later && later.status === 'approved') {
        later.stale = true;
      }
    }
  }

  private async checkImplementationAutoReview(workspacePath: string, state: WorkflowState, featureName: string | null) {
    const feature = state.features.find(f => f.name === featureName);
    if (!feature) return;

    const tasksPhase = feature.phases.find(p => p.phase === 'tasks');
    const implPhase = feature.phases.find(p => p.phase === 'implementation');

    if (!tasksPhase?.filePath || !implPhase) return;

    try {
      const content = await this.workspaceRepo.readFile(workspacePath, tasksPhase.filePath);
      const checkboxes = [...content.matchAll(/^\s*(?:[-*]|\d+\.)\s+\[( |x|X)\]/gm)];
      if (checkboxes.length > 0 && checkboxes.every(c => c[1].toLowerCase() === 'x')) {
        if (implPhase.status === 'running' || implPhase.status === 'idle') {
          implPhase.status = 'awaiting_review';
        }
      }
    } catch {
      // ignore
    }
  }
}

// Paths from the UI may be absolute or relative to the workspace.
function samePath(a: string, workspacePath: string, b: string): boolean {
  const abs = (p: string) => (p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p) ? p : `${workspacePath.replace(/[\\/]+$/, '')}/${p}`).replace(/\\/g, '/');
  return abs(a) === abs(b);
}

type PersonaVerdict = { status: PersonaRunStatus; reportPath?: string; note?: string; failureSummary?: string; suggestedFix?: string };

// The last explicit verdict in a report or output.
function verdictIn(text: string): PersonaRunStatus | null {
  const all = [...text.toUpperCase().matchAll(/VERDICT:\s*\**\s*(PASS|FAIL)/g)];
  const last = all.at(-1)?.[1];
  return last === 'PASS' ? 'passed' : last === 'FAIL' ? 'failed' : null;
}

// Why an implement run that exited cleanly didn't actually build, or
// undefined when it ticked at least one task.
function implementationShortfall(
  before: { done: number; total: number },
  after: { done: number; total: number },
  feature: string | null,
  quickBuild: boolean
): string | undefined {
  if (after.total === 0) {
    return quickBuild
      ? `The quick build finished without writing specs/${feature}/tasks.md, so nothing was built.`
      : `Implement found no tasks in specs/${feature}/tasks.md, so nothing was built. Run Planning and Tasks first, or use Quick build from the Specification card.`;
  }
  if (after.done > before.done) return undefined;
  if (before.total > 0 && before.done === before.total) {
    return `All ${after.total} tasks in tasks.md were already ticked before this run, and it ticked nothing new. If the code doesn't exist, untick the tasks that aren't really done and run Implement again.`;
  }
  return `Implement finished without completing any tasks (${after.done} of ${after.total} done).`;
}

// Ticked / total tasks in a feature's tasks.md.
function taskProgress(state: WorkflowState, featureName: string | null): { done: number; total: number } {
  const content = state.features.find(f => f.name === featureName)?.phases.find(p => p.phase === 'tasks')?.content ?? '';
  const boxes = [...content.matchAll(/^\s*(?:[-*]|\d+\.)\s+\[( |x|X)\]/gm)];
  return { done: boxes.filter(b => b[1] !== ' ').length, total: boxes.length };
}

// The question an agent stopped on, from the end of its output (plain text).
export function lastQuestion(output: string): string | undefined {
  const lines = output
    .replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '')
    .split(/\r?\n/)
    .map(l => l.replace(/\*\*/g, '').trim())
    .filter(Boolean)
    .filter(l => !/^(✓ Done|Process exited|▶ |→ )/.test(l));
  for (const line of lines.slice(-12).reverse()) {
    if (/\?\s*(\((yes|y)\s*\/\s*(no|n)\))?\s*$/i.test(line) && line.length > 10) return line.slice(0, 400);
  }
  return undefined;
}
