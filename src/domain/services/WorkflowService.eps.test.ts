import { describe, expect, it, vi } from 'vitest';
import { WorkflowService } from './WorkflowService';
import { MemoryHistory, MemoryWorkspace } from '../../test/meetingFakes';
import { AgentRunnerPort } from '../ports/out/AgentRunnerPort';
import { WorkflowState } from '../models/types';

describe('EPS workflow pause guard', () => {
  it('refuses new phases and quick builds before changing any workflow state', async () => {
    const workspace = new MemoryWorkspace();
    workspace.getWorkflowState = vi.fn(async (): Promise<WorkflowState> => ({ constitutionPhase: { phase: 'constitution', status: 'approved', filePath: null, content: null }, features: [], activeFeatureName: '001-feature' }));
    workspace.saveWorkflowState = vi.fn();
    const runner = { runPhase: vi.fn() } as unknown as AgentRunnerPort;
    const guard = vi.fn(async () => { throw new Error('Paused for owner answer'); });
    const service = new WorkflowService(workspace, runner, new MemoryHistory(), undefined, guard);
    await expect(service.runPhase('/project', 'implementation', null, { agentType: 'openai' })).rejects.toThrow(/Paused/);
    await expect(service.quickBuild('/project', '001-feature', { agentType: 'openai' })).rejects.toThrow(/Paused/);
    expect(guard).toHaveBeenCalledWith('/project', '001-feature');
    expect(workspace.saveWorkflowState).not.toHaveBeenCalled();
    expect(runner.runPhase).not.toHaveBeenCalled();
  });
});
