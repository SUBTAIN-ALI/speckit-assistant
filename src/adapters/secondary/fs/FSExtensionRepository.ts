import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { ExtensionRepositoryPort } from '../../../domain/ports/out/ExtensionRepositoryPort';
import { InstalledExtension } from '../../../domain/models/extensions';

export class FSExtensionRepository implements ExtensionRepositoryPort {
  async listInstalled(workspacePath: string): Promise<InstalledExtension[]> {
    const extDir = path.join(workspacePath, '.specify', 'extensions');
    const registryPath = path.join(extDir, '.registry');
    if (!fs.existsSync(registryPath)) return [];

    let registry: any = {};
    try {
      registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
    } catch {
      return [];
    }
    const entries = registry?.extensions && typeof registry.extensions === 'object' ? registry.extensions : {};

    const result: InstalledExtension[] = [];
    for (const [id, metaRaw] of Object.entries(entries)) {
      const meta = (metaRaw && typeof metaRaw === 'object' ? metaRaw : {}) as any;
      const manifest = this.readManifest(path.join(extDir, id, 'extension.yml'));
      result.push({
        id,
        name: manifest?.name || id,
        version: manifest?.version || meta.version || '?',
        enabled: meta.enabled !== false,
        source: meta.source,
        commandCount: manifest?.commandCount ?? 0,
        commands: manifest?.commands ?? [],
        hookCount: manifest?.hookCount ?? 0,
        priority: typeof meta.priority === 'number' ? meta.priority : undefined,
        description: manifest?.description,
      });
    }
    return result.sort((a, b) => a.id.localeCompare(b.id));
  }

  private readManifest(manifestPath: string): { name?: string; version?: string; description?: string; commandCount: number; commands: string[]; hookCount: number } | null {
    if (!fs.existsSync(manifestPath)) return null;
    try {
      const data = yaml.load(fs.readFileSync(manifestPath, 'utf-8')) as any;
      const ext = data?.extension || {};
      const commands = data?.provides?.commands;
      const commandCount = Array.isArray(commands) ? commands.length : 0;
      const names = Array.isArray(commands)
        ? commands.map((c: any) => c?.name).filter((n: unknown): n is string => typeof n === 'string')
        : [];
      let hookCount = 0;
      if (data?.hooks && typeof data.hooks === 'object') {
        for (const v of Object.values(data.hooks)) {
          hookCount += Array.isArray(v) ? v.length : v ? 1 : 0;
        }
      }
      return { name: ext.name, version: ext.version, description: ext.description, commandCount, commands: names, hookCount };
    } catch {
      return null;
    }
  }
}
