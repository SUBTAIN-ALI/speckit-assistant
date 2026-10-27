import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkflowService } from './WorkflowService';
import { WorkspaceRepositoryPort } from '../ports/out/WorkspaceRepositoryPort';
import { AgentRunnerPort } from '../ports/out/AgentRunnerPort';
import { ExecutionHistoryPort } from '../ports/out/ExecutionHistoryPort';
import { WorkflowState, FeatureWorkflow } from '../models/types';
import { DEFAULT_PERSONAS } from '../models/personas';

describe('WorkflowService', () => {
  let workspaceRepo: vi.Mocked<WorkspaceRepositoryPort>;
  let agentRunner: vi.Mocked<AgentRunnerPort>;
  let executionHistory: vi.Mocked<ExecutionHistoryPort>;
  let service: WorkflowService;

  const mockState: WorkflowState = {
    constitutionPhase: { phase: 'constitution', status: 'approved', filePath: '/path/constitution.md', content: '' },
    features: [
      {
        name: 'auth',
        phases: [
          { phase: 'specification', status: 'approved', filePath: '/path/spec.md', content: '' },
          { phase: 'planning', status: 'approved', filePath: '/path/plan.md', content: '' },
          { phase: 'tasks', status: 'approved', filePath: '/path/tasks.md', content: '- [x] task 1\n- [ ] task 2' },
          { phase: 'implementation', status: 'idle', filePath: null, content: null }
        ]
      }
    ],
    activeFeatureName: 'auth'
  };

  beforeEach(() => {
    workspaceRepo = {
      getWorkflowState: vi.fn().mockResolvedValue(JSON.parse(JSON.stringify(mockState))),
      saveWorkflowState: vi.fn().mockResolvedValue(undefined),
      toggleTask: vi.fn(),
      createFeature: vi.fn(),
      deleteFeature: vi.fn(),
      readFile: vi.fn(),
      writeFile: vi.fn()
    } as any;

    agentRunner = {
      runPhase: vi.fn(),
      stop: vi.fn()
    } as any;

    executionHistory = {
      start: vi.fn().mockImplementation(async (_ws, input) => ({ id: 'exec-1', logPath: '', startedAt: Date.now(), status: 'running', ...input })),
      appendLog: vi.fn(),
      finish: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue([]),
      readLog: vi.fn().mockResolvedValue('')
    } as any;

    service = new WorkflowService(workspaceRepo, agentRunner, executionHistory);
  });

  it('should fetch workflow state', async () => {
    const state = await service.getWorkflowState('/workspace');
    expect(state.activeFeatureName).toBe('auth');
    expect(workspaceRepo.getWorkflowState).toHaveBeenCalledWith('/workspace');
  });

  it('should set phase to approved', async () => {
    const state = await service.approvePhase('/workspace', 'implementation', 'auth');
    const authFeature = state.features.find(f => f.name === 'auth')!;
    const implPhase = authFeature.phases.find(p => p.phase === 'implementation')!;
    expect(implPhase.status).toBe('approved');
    expect(workspaceRepo.saveWorkflowState).toHaveBeenCalled();
  });

  it('ends a session still open for the phase when its card is approved or discarded', async () => {
    await service.approvePhase('/workspace', 'implementation', 'auth');
    expect(agentRunner.stop).toHaveBeenCalledWith('implementation', 'auth');
    await service.discardPhase('/workspace', 'planning', 'auth');
    expect(agentRunner.stop).toHaveBeenCalledWith('planning', 'auth');
  });

  it('finishes a running interactive phase: to review, session closed', async () => {
    const running: WorkflowState = JSON.parse(JSON.stringify(mockState));
    running.features[0].phases[1].status = 'running'; // planning stands in for Clarify
    workspaceRepo.getWorkflowState.mockResolvedValue(running);
    const state = await service.finishPhase('/workspace', 'planning', 'auth');
    expect(state.features[0].phases[1].status).toBe('awaiting_review');
    expect(agentRunner.stop).toHaveBeenCalledWith('planning', 'auth');
  });

  it('finish leaves a phase that is not running alone', async () => {
    const state = await service.finishPhase('/workspace', 'planning', 'auth');
    expect(state.features[0].phases[1].status).toBe('approved');
  });

  it('keeps the approval when an interactive run ends after the card was moved', async () => {
    // Clarify-style: the session stays open, the user approves, then it is killed (non-zero exit).
    agentRunner.runPhase.mockImplementation(async () => {
      await service.approvePhase('/workspace', 'implementation', 'auth');
      return 1;
    });
    const state = await service.runPhase('/workspace', 'implementation', 'auth', { agentType: 'claude' });
    expect(state.features[0].phases.find(p => p.phase === 'implementation')!.status).toBe('approved');
  });

  it('should discard phase and mark downstream phases as stale', async () => {
    // Set downstream phases to approved so they can become stale
    const stateWithApprovedPhases: WorkflowState = JSON.parse(JSON.stringify(mockState));
    const authFeatureMock = stateWithApprovedPhases.features[0];
    authFeatureMock.phases.forEach(p => p.status = 'approved');
    workspaceRepo.getWorkflowState.mockResolvedValue(stateWithApprovedPhases);

    // Discard specification phase
    const state = await service.discardPhase('/workspace', 'specification', 'auth');
    const authFeature = state.features.find(f => f.name === 'auth')!;
    
    // Specification should be idle
    const spec = authFeature.phases.find(p => p.phase === 'specification')!;
    expect(spec.status).toBe('idle');

    // Planning, tasks, implementation should be stale
    const plan = authFeature.phases.find(p => p.phase === 'planning')!;
    const tasks = authFeature.phases.find(p => p.phase === 'tasks')!;
    const impl = authFeature.phases.find(p => p.phase === 'implementation')!;

    expect(plan.stale).toBe(true);
    expect(tasks.stale).toBe(true);
    expect(impl.stale).toBe(true);
  });

  it('should auto-complete implementation when all tasks are checked', async () => {
    const completedTasksState: WorkflowState = JSON.parse(JSON.stringify(mockState));
    // Set all tasks checked in mock file content
    const tasksPhase = completedTasksState.features[0].phases.find(p => p.phase === 'tasks')!;
    tasksPhase.filePath = '/path/tasks.md';
    
    workspaceRepo.getWorkflowState.mockResolvedValue(completedTasksState);
    workspaceRepo.toggleTask.mockResolvedValue(completedTasksState);
    workspaceRepo.readFile.mockResolvedValue('- [x] task 1\n- [x] task 2');

    const state = await service.toggleTask('/workspace', 'auth', 1, true);
    
    const authFeature = state.features.find(f => f.name === 'auth')!;
    const implPhase = authFeature.phases.find(p => p.phase === 'implementation')!;
    expect(implPhase.status).toBe('awaiting_review');
  });

  it('should handle agent run errors, reverting phase status to idle', async () => {
    const errorMsg = 'Agent execution crash';
    agentRunner.runPhase.mockRejectedValue(new Error(errorMsg));

    await expect(
      service.runPhase('/workspace', 'specification', 'auth', { agentType: 'claude' })
    ).rejects.toThrow(errorMsg);

    expect(workspaceRepo.saveWorkflowState).toHaveBeenCalled();
  });

  it('should handle non-zero exit code, setting status back to idle', async () => {
    agentRunner.runPhase.mockResolvedValue(1);

    const state = await service.runPhase('/workspace', 'specification', 'auth', { agentType: 'claude' });
    const authFeature = state.features.find(f => f.name === 'auth')!;
    const specPhase = authFeature.phases.find(p => p.phase === 'specification')!;
    expect(specPhase.status).toBe('idle');
  });

  it('records captured cost on the phase when the runner reports it via onCost', async () => {
    const fakeCost = { totalTokens: 300, costUSD: 0.0033, durationMs: 1200, source: 'estimated' as const };
    agentRunner.runPhase = vi.fn().mockImplementation(
      (_w: string, _p: string, _f: string, _a: any, _u: any, _onData: any, onCost: any) => {
        onCost?.(fakeCost);
        return Promise.resolve(0);
      }
    );

    const state = await service.runPhase('/workspace', 'specification', 'auth', { agentType: 'claude' });
    const spec = state.features.find(f => f.name === 'auth')!.phases.find(p => p.phase === 'specification')!;
    expect(spec.cost).toEqual(fakeCost);
  });

  it('should auto-review implementation phase upon completion inside runPhase', async () => {
    workspaceRepo.readFile.mockResolvedValue('- [x] task 1\n- [x] task 2');

    const runningState: WorkflowState = JSON.parse(JSON.stringify(mockState));
    const tasksPhase = runningState.features[0].phases.find(p => p.phase === 'tasks')!;
    tasksPhase.filePath = '/path/tasks.md';
    // The run completes the remaining task.
    agentRunner.runPhase.mockImplementation(async () => { tasksPhase.content = '- [x] task 1\n- [x] task 2'; return 0; });
    const implPhaseMock = runningState.features[0].phases.find(p => p.phase === 'implementation')!;
    implPhaseMock.status = 'running';

    workspaceRepo.getWorkflowState.mockResolvedValue(runningState);

    const state = await service.runPhase('/workspace', 'implementation', 'auth', { agentType: 'claude' });
    const authFeature = state.features.find(f => f.name === 'auth')!;
    const implPhase = authFeature.phases.find(p => p.phase === 'implementation')!;
    expect(implPhase.status).toBe('awaiting_review');
  });

  it('should approve and discard constitution phase, propagating staleness', async () => {
    // Approve constitution
    const stateApproved = await service.approvePhase('/workspace', 'constitution', null);
    expect(stateApproved.constitutionPhase.status).toBe('approved');

    // Make all feature phases approved
    const stateWithApprovedPhases: WorkflowState = JSON.parse(JSON.stringify(mockState));
    stateWithApprovedPhases.features[0].phases.forEach(p => {
      p.status = 'approved';
    });
    workspaceRepo.getWorkflowState.mockResolvedValue(stateWithApprovedPhases);

    // Discard constitution
    const stateDiscarded = await service.discardPhase('/workspace', 'constitution', null);
    expect(stateDiscarded.constitutionPhase.status).toBe('idle');
    
    // All downstream feature phases must become stale
    const authFeature = stateDiscarded.features.find(f => f.name === 'auth')!;
    authFeature.phases.forEach(p => {
      expect(p.stale).toBe(true);
    });
  });

  it('should handle file reading errors in checkImplementationAutoReview gracefully', async () => {
    const completedTasksState: WorkflowState = JSON.parse(JSON.stringify(mockState));
    const tasksPhase = completedTasksState.features[0].phases.find(p => p.phase === 'tasks')!;
    tasksPhase.filePath = '/path/tasks.md';
    
    workspaceRepo.getWorkflowState.mockResolvedValue(completedTasksState);
    workspaceRepo.toggleTask.mockResolvedValue(completedTasksState);
    
    // Mock readFile to reject
    workspaceRepo.readFile.mockRejectedValue(new Error('File access error'));

    const state = await service.toggleTask('/workspace', 'auth', 1, true);
    expect(state).toBeDefined();
    // Implementation status remains idle instead of throwing
    const authFeature = state.features.find(f => f.name === 'auth')!;
    const implPhase = authFeature.phases.find(p => p.phase === 'implementation')!;
    expect(implPhase.status).toBe('idle');
  });

  describe('implementation review gate', () => {
    const gateState = (): WorkflowState => {
      const s: WorkflowState = JSON.parse(JSON.stringify(mockState));
      const impl = s.features[0].phases.find(p => p.phase === 'implementation')!;
      impl.status = 'running';
      return s;
    };

    it('runs personas in order and advances to awaiting_review when all pass', async () => {
      workspaceRepo.getWorkflowState.mockResolvedValue(gateState());
      workspaceRepo.readFile.mockResolvedValue('looks good\n\nVERDICT: PASS');
      const order: string[] = [];
      agentRunner.runPersona = vi.fn().mockImplementation(
        (_w: string, _f: string, persona: any) => {
          order.push(persona.id);
          return Promise.resolve(0);
        }
      );

      const state = await service.runImplementationGate(
        '/workspace',
        'auth',
        { agentType: 'claude' },
        DEFAULT_PERSONAS
      );

      expect(order).toEqual(['qa', 'code-review', 'security', 'tech-lead']);
      const impl = state.features[0].phases.find(p => p.phase === 'implementation')!;
      expect(impl.status).toBe('awaiting_review');
      expect(impl.personas?.map(p => p.status)).toEqual(['passed', 'passed', 'passed', 'passed']);
    });

    it('stops at the first failing persona and leaves implementation running', async () => {
      workspaceRepo.getWorkflowState.mockResolvedValue(gateState());
      workspaceRepo.readFile.mockImplementation((_w: string, p: string) =>
        Promise.resolve(p.includes('security') ? 'blocking issue\n\nVERDICT: FAIL' : 'VERDICT: PASS')
      );
      const order: string[] = [];
      agentRunner.runPersona = vi.fn().mockImplementation(
        (_w: string, _f: string, persona: any) => {
          order.push(persona.id);
          return Promise.resolve(0);
        }
      );

      const state = await service.runImplementationGate(
        '/workspace',
        'auth',
        { agentType: 'claude' },
        DEFAULT_PERSONAS
      );

      // tech-lead must NOT run after security fails
      expect(order).toEqual(['qa', 'code-review', 'security']);
      const impl = state.features[0].phases.find(p => p.phase === 'implementation')!;
      expect(impl.status).toBe('running');
      const byId = Object.fromEntries((impl.personas ?? []).map(p => [p.id, p.status]));
      expect(byId.security).toBe('failed');
      expect(byId['tech-lead']).toBe('idle');
    });

    it('falls back to exit code when no VERDICT marker is present', async () => {
      workspaceRepo.getWorkflowState.mockResolvedValue(gateState());
      workspaceRepo.readFile.mockRejectedValue(new Error('File not found')); // triggers catch block in resolvePersonaVerdict
      // qa exits non-zero -> failed; gate stops
      agentRunner.runPersona = vi.fn().mockResolvedValue(1);

      const state = await service.runImplementationGate(
        '/workspace',
        'auth',
        { agentType: 'claude' },
        [DEFAULT_PERSONAS[0]] // only QA enabled
      );

      const impl = state.features[0].phases.find(p => p.phase === 'implementation')!;
      expect(impl.personas?.find(p => p.id === 'qa')?.status).toBe('failed');
      expect(impl.status).toBe('running');
    });
  });

  it('runs implementation gate from runPhase if personas are provided', async () => {
    const runningState: WorkflowState = JSON.parse(JSON.stringify(mockState));
    const implPhase = runningState.features[0].phases.find(p => p.phase === 'implementation')!;
    implPhase.status = 'idle';
    workspaceRepo.getWorkflowState.mockResolvedValue(runningState);
    workspaceRepo.readFile.mockResolvedValue('VERDICT: PASS');
    const tasksPhase = runningState.features[0].phases.find(p => p.phase === 'tasks')!;
    agentRunner.runPhase = vi.fn().mockImplementation(async () => { tasksPhase.content = '- [x] task 1\n- [x] task 2'; return 0; });
    agentRunner.runPersona = vi.fn().mockResolvedValue(0);

    const state = await service.runPhase(
      '/workspace',
      'implementation',
      'auth',
      { agentType: 'claude' },
      '',
      undefined,
      [DEFAULT_PERSONAS[0]] // pass personas
    );

    const impl = state.features[0].phases.find(p => p.phase === 'implementation')!;
    expect(impl.status).toBe('awaiting_review');
  });



  it('does not call Implement done when it completed no tasks, and keeps its question', async () => {
    const st: WorkflowState = JSON.parse(JSON.stringify(mockState)); // tasks: 1 of 2 done
    workspaceRepo.getWorkflowState.mockResolvedValue(st);
    agentRunner.runPhase = vi.fn().mockImplementation(async (_w, _p, _f, _c, _u, onData) => {
      onData('auth.md | 42 | 0 | 42 | ✗ FAIL\n**Do you want to proceed with implementation anyway? (yes/no)**\n✓ Done in 22s · 3 turns · $0.317\n');
      return 0;
    });
    agentRunner.runPersona = vi.fn().mockResolvedValue(0);
    const state = await service.runPhase('/workspace', 'implementation', 'auth', { agentType: 'claude' }, '', undefined, [DEFAULT_PERSONAS[0]]);
    const impl = state.features[0].phases.find(p => p.phase === 'implementation')!;
    expect(impl.status).toBe('idle');
    expect(impl.attention).toEqual({
      message: 'Implement finished without completing any tasks (1 of 2 done).',
      question: 'Do you want to proceed with implementation anyway? (yes/no)',
    });
    expect(agentRunner.runPersona).not.toHaveBeenCalled(); // no review of code that wasn't written

    // Running again clears it.
    agentRunner.runPhase = vi.fn().mockImplementation(async () => { st.features[0].phases[2].content = '- [x] task 1\n- [x] task 2'; return 0; });
    const again = await service.runPhase('/workspace', 'implementation', 'auth', { agentType: 'claude' });
    expect(again.features[0].phases.find(p => p.phase === 'implementation')!.attention).toBeUndefined();
  });

  describe('an implement run that built nothing', () => {
    const run = async (tasksContent: string | null, output = '') => {
      const st: WorkflowState = JSON.parse(JSON.stringify(mockState));
      const tasks = st.features[0].phases.find(p => p.phase === 'tasks')!;
      tasks.content = tasksContent;
      if (tasksContent === null) tasks.filePath = null;
      workspaceRepo.getWorkflowState.mockResolvedValue(st);
      agentRunner.runPhase = vi.fn().mockImplementation(async (_w, _p, _f, _c, _u, onData) => { onData(output); return 0; });
      agentRunner.runPersona = vi.fn().mockResolvedValue(0);
      const state = await service.runPhase('/workspace', 'implementation', 'auth', { agentType: 'claude' }, '', undefined, [DEFAULT_PERSONAS[0]]);
      return state.features[0].phases.find(p => p.phase === 'implementation')!;
    };

    it('is not sent to review when the feature has no tasks.md', async () => {
      const impl = await run(null, 'ERROR: plan.md not found in specs/auth\nRun /speckit-plan first.\n');
      expect(impl.status).toBe('idle');
      expect(impl.attention?.message).toContain('no tasks in specs/auth/tasks.md');
      expect(agentRunner.runPersona).not.toHaveBeenCalled();
    });

    it('is not sent to review when every task was already ticked and it ticked nothing', async () => {
      const impl = await run('- [x] task 1\n- [x] task 2', '**Do you want to proceed with implementation anyway? (yes/no)**\n');
      expect(impl.status).toBe('idle');
      expect(impl.attention).toEqual({
        message: expect.stringContaining('All 2 tasks in tasks.md were already ticked'),
        question: 'Do you want to proceed with implementation anyway? (yes/no)',
      });
      expect(agentRunner.runPersona).not.toHaveBeenCalled();
    });
  });

  describe('quick build', () => {
    const specOnly = (): WorkflowState => ({
      constitutionPhase: { phase: 'constitution', status: 'approved', filePath: '/c.md', content: '' },
      activeFeatureName: 'auth',
      features: [{
        name: 'auth',
        phases: [
          { phase: 'specification', status: 'awaiting_review', filePath: '/ws/specs/auth/spec.md', content: '# Spec' },
          { phase: 'clarification', status: 'idle', filePath: null, content: null },
          { phase: 'planning', status: 'idle', filePath: null, content: null },
          { phase: 'checklist', status: 'awaiting_review', filePath: '/ws/specs/auth/checklists/r.md', content: '' },
          { phase: 'analyze', status: 'idle', filePath: null, content: null },
          { phase: 'tasks', status: 'idle', filePath: null, content: null },
          { phase: 'taskstoissues', status: 'idle', filePath: null, content: null },
          { phase: 'implementation', status: 'idle', filePath: null, content: null },
        ],
      }],
    });

    it('approves the spec, skips the phases in between, and builds from the spec', async () => {
      const st = specOnly();
      workspaceRepo.getWorkflowState.mockResolvedValue(st);
      agentRunner.runPhase = vi.fn().mockImplementation(async () => {
        // The agent writes tasks.md and completes it.
        const tasks = st.features[0].phases.find(p => p.phase === 'tasks')!;
        tasks.filePath = '/ws/specs/auth/tasks.md';
        tasks.content = '## Assumptions\n- [x] T001 a\n- [x] T002 b';
        return 0;
      });
      const state = await service.quickBuild('/workspace', 'auth', { agentType: 'claude' });
      const by = (ph: string) => state.features[0].phases.find(p => p.phase === ph)!;
      expect(by('specification').status).toBe('approved');
      expect(['clarification', 'planning', 'checklist', 'analyze', 'tasks', 'taskstoissues'].map(p => by(p).status)).toEqual(Array(6).fill('skipped'));
      expect(by('implementation')).toMatchObject({ status: 'awaiting_review', quickBuild: true });

      // No tasks.md yet → the quick-build instruction replaces /speckit.implement.
      const [, phase, feature, , userPrompt, , , options] = (agentRunner.runPhase as any).mock.calls[0];
      expect([phase, feature, userPrompt]).toEqual(['implementation', 'auth', undefined]);
      expect(options.instruction).toContain('specs/auth/tasks.md');
      expect(options.instruction).toContain('.specify/templates/tasks-template.md');
      expect(options.instruction).toContain('## Assumptions');
      expect(options.instruction).toContain('understand the existing project');
    });

    it('with an existing tasks.md, runs /speckit.implement with the no-questions context', async () => {
      const st = specOnly();
      const tasks = st.features[0].phases.find(p => p.phase === 'tasks')!;
      tasks.filePath = '/ws/specs/auth/tasks.md';
      tasks.content = '- [ ] T001 a';
      workspaceRepo.getWorkflowState.mockResolvedValue(st);
      agentRunner.runPhase = vi.fn().mockImplementation(async () => { tasks.content = '- [x] T001 a'; return 0; });
      await service.quickBuild('/workspace', 'auth', { agentType: 'claude' });
      const [, , , , userPrompt, , , options] = (agentRunner.runPhase as any).mock.calls[0];
      expect(userPrompt).toContain('Never stop to ask'); // placed before /speckit.implement
      expect(options).toBeUndefined();
    });

    it('flags a quick build that wrote no tasks.md', async () => {
      workspaceRepo.getWorkflowState.mockResolvedValue(specOnly());
      agentRunner.runPhase = vi.fn().mockResolvedValue(0);
      const state = await service.quickBuild('/workspace', 'auth', { agentType: 'claude' });
      const impl = state.features[0].phases.find(p => p.phase === 'implementation')!;
      expect(impl.status).toBe('idle');
      expect(impl.attention?.message).toContain('without writing specs/auth/tasks.md');
    });

    it('needs a spec, and refuses while an agent runs on the feature', async () => {
      const noSpec = specOnly();
      noSpec.features[0].phases[0].filePath = null;
      workspaceRepo.getWorkflowState.mockResolvedValue(noSpec);
      await expect(service.quickBuild('/workspace', 'auth', { agentType: 'claude' })).rejects.toThrow('Write the spec first');

      const busy = specOnly();
      busy.features[0].phases[3].status = 'running';
      workspaceRepo.getWorkflowState.mockResolvedValue(busy);
      await expect(service.quickBuild('/workspace', 'auth', { agentType: 'claude' })).rejects.toThrow('already running');
    });
  });

  describe('review gate: personas that are not installed', () => {
    const personasExt = (enabled = true) => ({
      id: 'personas', name: 'Personas', version: '1.0.0', enabled, commandCount: 4, hookCount: 0,
      commands: ['speckit.personas.qa', 'speckit.personas.code', 'speckit.personas.security', 'speckit.personas.techlead'],
    });
    const gateWith = async (installed: any[], personas = DEFAULT_PERSONAS) => {
      const svc = new WorkflowService(workspaceRepo, agentRunner, executionHistory, { listInstalled: vi.fn().mockResolvedValue(installed) });
      workspaceRepo.getWorkflowState.mockResolvedValue(JSON.parse(JSON.stringify(mockState)));
      workspaceRepo.readFile.mockResolvedValue('VERDICT: PASS');
      agentRunner.runPersona = vi.fn().mockResolvedValue(0);
      const state = await svc.runImplementationGate('/workspace', 'auth', { agentType: 'claude' }, personas);
      return state.features[0].phases.find(p => p.phase === 'implementation')!;
    };

    it('blocks the gate without running anyone when the extension is missing', async () => {
      const impl = await gateWith([{ ...personasExt(), id: 'meetings', commands: ['speckit.meetings.import'] }]);
      expect(agentRunner.runPersona).not.toHaveBeenCalled();
      expect(executionHistory.start).not.toHaveBeenCalled();
      expect(impl.status).toBe('running');
      const qa = impl.personas!.find(p => p.id === 'qa')!;
      expect(qa.status).toBe('unavailable');
      expect(qa.reportPath).toBeNull();
      expect(qa.note).toContain("/speckit.personas.qa isn't installed");
      expect(qa.note).toContain('“Review Personas”');
      expect(impl.personas!.every(p => p.status === 'unavailable')).toBe(true);
    });

    it('says so when the extension is installed but disabled', async () => {
      const impl = await gateWith([personasExt(false)]);
      expect(agentRunner.runPersona).not.toHaveBeenCalled();
      expect(impl.personas![0].note).toContain('is disabled');
    });

    it('runs normally when an enabled extension provides every command', async () => {
      const impl = await gateWith([personasExt()]);
      expect(agentRunner.runPersona).toHaveBeenCalledTimes(4);
      expect(impl.status).toBe('awaiting_review');
    });

    it('only marks the personas that are missing', async () => {
      const custom = DEFAULT_PERSONAS.map(p => p.id === 'qa' ? { ...p, command: '/my-qa' } : p.id === 'security' ? { ...p, command: '/speckit.analyze' } : p);
      const impl = await gateWith([{ ...personasExt(), commands: ['speckit.personas.code'] }], custom);
      const byId = Object.fromEntries(impl.personas!.map(p => [p.id, p.status]));
      // custom and core Spec Kit commands aren't checked
      expect(byId).toEqual({ qa: 'idle', 'code-review': 'idle', security: 'idle', 'tech-lead': 'unavailable' });
      expect(agentRunner.runPersona).not.toHaveBeenCalled();
    });

    it('runs anyway when installed extensions cannot be read', async () => {
      const svc = new WorkflowService(workspaceRepo, agentRunner, executionHistory, { listInstalled: vi.fn().mockRejectedValue(new Error('EACCES')) });
      workspaceRepo.getWorkflowState.mockResolvedValue(JSON.parse(JSON.stringify(mockState)));
      workspaceRepo.readFile.mockResolvedValue('VERDICT: PASS');
      agentRunner.runPersona = vi.fn().mockResolvedValue(0);
      await svc.runImplementationGate('/workspace', 'auth', { agentType: 'claude' }, [DEFAULT_PERSONAS[0]]);
      expect(agentRunner.runPersona).toHaveBeenCalledTimes(1);
    });
  });

  describe('review gate verdicts', () => {
    const gate = async (files: Record<string, string>, output = '') => {
      const st: WorkflowState = JSON.parse(JSON.stringify(mockState));
      workspaceRepo.getWorkflowState.mockResolvedValue(st);
      workspaceRepo.readFile.mockImplementation(async (_w: string, f: string) => files[f] ?? '');
      agentRunner.runPersona = vi.fn().mockImplementation(async (_w, _f, _p, _c, onData) => { onData(output); return 0; });
      const state = await service.runImplementationGate('/workspace', 'auth', { agentType: 'claude' }, [DEFAULT_PERSONAS[0]]);
      return state.features[0].phases.find(p => p.phase === 'implementation')!.personas![0];
    };

    it('fails a reviewer that recorded no verdict, even with a clean exit', async () => {
      const p = await gate({ 'specs/auth/qa-report.md': '# QA\nScope: No application code exists yet.' });
      expect(p.status).toBe('failed');
      expect(p.reportPath).toBe('specs/auth/qa-report.md');
      expect(p.note).toContain('No verdict recorded');
    });

    it('reads the verdict from where the reviewer wrote it, or from its output', async () => {
      expect((await gate({ 'specs/auth/qa-report.md': '...\n**VERDICT: PASS**' })).status).toBe('passed');
      expect((await gate({ 'specs/auth/reviews/qa.md': 'VERDICT: FAIL' })).status).toBe('failed');
      expect((await gate({}, 'Report written.\nVERDICT: PASS\n')).status).toBe('passed');
    });
  });

  it('delegates writeStdin to agentRunner.writeStdin', async () => {
    agentRunner.writeStdin = vi.fn().mockResolvedValue(true);
    const result = await service.writeStdin('specification', 'auth', 'user input', 'qa');
    expect(result).toBe(true);
    expect(agentRunner.writeStdin).toHaveBeenCalledWith('specification', 'auth', 'user input', 'qa');
  });

  it('delegates resize to agentRunner.resize', async () => {
    agentRunner.resize = vi.fn().mockResolvedValue(true);
    const result = await service.resize('specification', 'auth', 80, 24, 'qa');
    expect(result).toBe(true);
    expect(agentRunner.resize).toHaveBeenCalledWith('specification', 'auth', 80, 24, 'qa');
  });

  it('calls writeFile and triggers state update', async () => {
    workspaceRepo.writeFile = vi.fn().mockResolvedValue(undefined);
    workspaceRepo.getWorkflowState = vi.fn().mockResolvedValue(mockState);
    workspaceRepo.saveWorkflowState = vi.fn().mockResolvedValue(undefined);
    const state = await service.writeFile('/workspace', 'file.md', 'content');
    expect(state).toBe(mockState);
    expect(workspaceRepo.writeFile).toHaveBeenCalledWith('/workspace', 'file.md', 'content');
    expect(workspaceRepo.saveWorkflowState).toHaveBeenCalled();
  });

  it('calls stop on agentRunner', async () => {
    agentRunner.stop = vi.fn().mockResolvedValue(true);
    const result = await service.stop('implementation', 'auth', 'qa');
    expect(result).toBe(true);
    expect(agentRunner.stop).toHaveBeenCalledWith('implementation', 'auth', 'qa');
  });

  describe('edge case branches', () => {
    it('discardPhase returns state unchanged if feature is not found', async () => {
      const state = await service.discardPhase('/workspace', 'specification', 'non-existent-feature');
      expect(state.activeFeatureName).toBe('auth');
    });

    it('discardPhase returns state unchanged if phase index is invalid', async () => {
      const state = await service.discardPhase('/workspace', 'invalid-phase' as any, 'auth');
      expect(state.activeFeatureName).toBe('auth');
    });

    it('toggleTask does not auto-review if feature is not found', async () => {
      workspaceRepo.toggleTask.mockResolvedValue(mockState);
      const state = await service.toggleTask('/workspace', 'non-existent-feature', 0, true);
      expect(state).toBe(mockState);
    });

    it('toggleTask does not auto-review if tasksPhase filePath is missing', async () => {
      const tasksMissingState: WorkflowState = JSON.parse(JSON.stringify(mockState));
      const tasksPhase = tasksMissingState.features[0].phases.find(p => p.phase === 'tasks')!;
      tasksPhase.filePath = null;
      workspaceRepo.toggleTask.mockResolvedValue(tasksMissingState);

      const state = await service.toggleTask('/workspace', 'auth', 0, true);
      expect(state).toBe(tasksMissingState);
    });
  });
});


