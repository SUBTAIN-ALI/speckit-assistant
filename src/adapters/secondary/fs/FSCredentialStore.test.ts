import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FSCredentialStore } from './FSCredentialStore';

const dirs: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'speckit-creds-'));
  dirs.push(d);
  return d;
};
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe('FSCredentialStore', () => {
  it('returns {} when the file is missing or corrupt', async () => {
    const d = tmp();
    expect(await new FSCredentialStore(path.join(d, 'none.json')).load()).toEqual({});
    fs.writeFileSync(path.join(d, 'bad.json'), '{not json');
    expect(await new FSCredentialStore(path.join(d, 'bad.json')).load()).toEqual({});
  });

  it('saves with owner-only permissions and round-trips', async () => {
    const file = path.join(tmp(), 'nested', 'credentials.json');
    const store = new FSCredentialStore(file);
    await store.save({ llm: { provider: 'openai', keys: { openai: 'sk-x' }, models: {} } });
    expect(await store.load()).toEqual({ llm: { provider: 'openai', keys: { openai: 'sk-x' }, models: {} } });
    if (process.platform !== 'win32') {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      expect(fs.statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
    }
    // No temp files left behind.
    expect(fs.readdirSync(path.dirname(file))).toEqual(['credentials.json']);
  });

  it('tightens permissions on a pre-existing loose file', async () => {
    const file = path.join(tmp(), 'credentials.json');
    fs.writeFileSync(file, '{}', { mode: 0o644 });
    await new FSCredentialStore(file).save({});
    if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });
});
