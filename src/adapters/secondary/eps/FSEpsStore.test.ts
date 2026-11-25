import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { FSEpsStore } from './FSEpsStore';
import { emptyEpsState } from '../../../domain/models/eps';

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true }); });
const setup = async () => { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'eps-store-')); dirs.push(root); return { root, store: new FSEpsStore(root) }; };
describe('EPS persisted state', () => {
  it('keeps secrets separate and private and restores state across instances', async () => {
    const { root, store } = await setup();
    await store.set('staging', 'eps_mcp_private');
    const state = emptyEpsState(); state.enabled = true;
    await store.save('/project-a', state);
    const restored = new FSEpsStore(root);
    expect((await restored.load('/project-a')).enabled).toBe(true);
    expect((await restored.load('/project-b')).enabled).toBe(false);
    expect(await restored.get('staging')).toBe('eps_mcp_private');
    const files = await fs.readdir(root);
    for (const file of files) expect((await fs.stat(path.join(root, file))).mode & 0o777).toBe(0o600);
    expect(JSON.stringify(await restored.load('/project-a'))).not.toContain('eps_mcp_private');
  });
  it('serializes competing workers so updates are not lost', async () => {
    const { root, store } = await setup();
    const second = new FSEpsStore(root);
    await Promise.all([store, second].map(s => s.exclusive('/project', async () => {
      const state = await s.load('/project');
      await new Promise(resolve => setTimeout(resolve, 10));
      state.lastSync = String(Number(state.lastSync ?? 0) + 1);
      await s.save('/project', state);
    })));
    expect((await store.load('/project')).lastSync).toBe('2');
  });
  it('recovers a lock left by a dead process and fails visibly on corrupt state', async () => {
    const { root, store } = await setup();
    await store.save('/project', emptyEpsState());
    const stateFile = (await fs.readdir(root)).find(f => f.endsWith('.json'))!;
    await fs.writeFile(path.join(root, stateFile + '.lock'), '2147483647');
    await expect(store.exclusive('/project', async () => 42)).resolves.toBe(42);
    await fs.writeFile(path.join(root, stateFile), 'invalid');
    await expect(store.load('/project')).rejects.toThrow();
  });
});
