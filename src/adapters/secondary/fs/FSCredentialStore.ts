import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CredentialStorePort } from '../../../domain/ports/out/CredentialStorePort';
import { IntegrationCredentials } from '../../../domain/models/credentials';

// Secrets live in the user's home directory, outside any workspace, so they can't
// be committed. The directory is 0700 and the file 0600; writes go through a temp
// file + rename so a crash never leaves a half-written credentials file.
export function defaultCredentialsPath(): string {
  return process.env.SPECKIT_CREDENTIALS_PATH || path.join(os.homedir(), '.speckit-assistant', 'credentials.json');
}

export class FSCredentialStore implements CredentialStorePort {
  constructor(private filePath: string = defaultCredentialsPath()) {}

  async load(): Promise<IntegrationCredentials> {
    try {
      const data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      return data && typeof data === 'object' ? (data as IntegrationCredentials) : {};
    } catch {
      return {};
    }
  }

  async save(credentials: IntegrationCredentials): Promise<void> {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(credentials, null, 2), { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(tmp, this.filePath);
    // rename keeps the temp file's mode, but tighten in case the file pre-existed looser.
    fs.chmodSync(this.filePath, 0o600);
  }
}
