import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WorkflowService } from './WorkflowService';
import { FSWorkspaceRepository } from '../../adapters/secondary/fs/FSWorkspaceRepository';
import { MemoryHistory } from '../../test/meetingFakes';

const FIXTURE = path.resolve(__dirname, '../../../test/fixtures/speckit-demo');

describe('WorkflowService.markStale and workspace directory ops', () => {
  let ws: string;
  const repo = new FSWorkspaceRepository();
  const svc = new WorkflowService(repo, {} as never, new MemoryHistory());

  beforeEach(() => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'speckit-stale-'));
    fs.cpSync(FIXTURE, ws, { recursive: true });
  });
  afterEach(() => fs.rmSync(ws, { recursive: true, force: true }));

  it('flags the spec and approved downstream phases of a feature', async () => {
    const feature = '001-user-authentication';
    await svc.approvePhase(ws, 'planning', feature);
    const state = await svc.markStale(ws, 'specification', feature);
    const phases = state.features.find(f => f.name === feature)!.phases;
    expect(phases.find(p => p.phase === 'specification')!.stale).toBe(true);
    expect(phases.find(p => p.phase === 'planning')!.stale).toBe(true);
    // Persisted.
    const reloaded = (await svc.getWorkflowState(ws)).features.find(f => f.name === feature)!.phases;
    expect(reloaded.find(p => p.phase === 'specification')!.stale).toBe(true);
  });

  it('does nothing for a phase that has not produced output', async () => {
    fs.mkdirSync(path.join(ws, 'specs', '004-empty'));
    const state = await svc.markStale(ws, 'specification', '004-empty');
    expect(state.features.find(f => f.name === '004-empty')!.phases.find(p => p.phase === 'specification')!.stale).toBeFalsy();
  });

  it('lists and deletes directories inside the workspace only', async () => {
    fs.mkdirSync(path.join(ws, '.specify', 'meetings', 'b'), { recursive: true });
    fs.mkdirSync(path.join(ws, '.specify', 'meetings', 'a'));
    fs.writeFileSync(path.join(ws, '.specify', 'meetings', 'file.txt'), 'x');
    expect(await repo.listDirectories(ws, '.specify/meetings')).toEqual(['a', 'b']);
    expect(await repo.listDirectories(ws, 'nope')).toEqual([]);

    await repo.deleteDirectory(ws, '.specify/meetings/a');
    expect(await repo.listDirectories(ws, '.specify/meetings')).toEqual(['b']);

    await expect(repo.listDirectories(ws, '../..')).rejects.toThrow(/Access denied/);
    await expect(repo.deleteDirectory(ws, '..')).rejects.toThrow(/Access denied/);
    await expect(repo.deleteDirectory(ws, '.')).rejects.toThrow(/Access denied/);
    expect(fs.existsSync(ws)).toBe(true);
  });
});
