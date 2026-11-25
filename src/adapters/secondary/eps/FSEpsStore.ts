import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { createHash, randomUUID } from 'crypto';
import { EpsEnvironment, EpsState, emptyEpsState } from '../../../domain/models/eps';
import { EpsSecretsPort, EpsStorePort } from '../../../domain/ports/out/EpsPort';

// Deliberately separate from the existing Zoom/LLM credentials and workspace files.
export class FSEpsStore implements EpsStorePort, EpsSecretsPort {
  constructor(private root = path.join(os.homedir(), '.speckit-assistant', 'eps')) {}
  private statePath(workspace: string) {
    return path.join(this.root, createHash('sha256').update(path.resolve(workspace)).digest('hex') + '.json');
  }
  private async read<T>(file: string, fallback: T): Promise<T> {
    try { return JSON.parse(await fs.readFile(file, 'utf8')) as T; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback; throw error; }
  }
  private async write(file: string, value: unknown) {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
      await fs.rename(temp, file);
    } finally { await fs.unlink(temp).catch(() => {}); }
  }
  load(workspace: string) { return this.read(this.statePath(workspace), emptyEpsState()); }
  save(workspace: string, state: EpsState) { return this.write(this.statePath(workspace), state); }
  async get(environment: EpsEnvironment) {
    const saved = await this.read<{ token?: string }>(path.join(this.root, `${environment}-token.json`), {});
    return saved.token || process.env[environment === 'staging' ? 'EPS_MCP_STAGING_TOKEN' : 'EPS_MCP_PRODUCTION_TOKEN'] || process.env.EPS_MCP_TOKEN;
  }
  set(environment: EpsEnvironment, token: string) { return this.write(path.join(this.root, `${environment}-token.json`), { token }); }
  async exclusive<T>(workspace: string, action: () => Promise<T>): Promise<T> {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    const lock = this.statePath(workspace) + '.lock';
    const deadline = Date.now() + 30_000;
    for (;;) {
      try {
        const handle = await fs.open(lock, 'wx', 0o600);
        await handle.writeFile(String(process.pid));
        await handle.close();
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const pid = Number(await fs.readFile(lock, 'utf8').catch(() => ''));
        if (pid > 0) {
          try { process.kill(pid, 0); }
          catch (e) { if ((e as NodeJS.ErrnoException).code === 'ESRCH') { await fs.unlink(lock).catch(() => {}); continue; } }
        }
        if (Date.now() > deadline) throw new Error('EPS synchronization is busy. Try again shortly.');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    try { return await action(); } finally { await fs.unlink(lock); }
  }
}
