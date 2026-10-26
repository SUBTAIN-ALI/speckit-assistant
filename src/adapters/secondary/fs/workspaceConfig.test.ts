import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  forgetWorkspace,
  listFolders,
  listWorkspaces,
  readWorkspaceConfig,
  resolveWorkspaceInput,
  saveCurrentWorkspace,
} from './workspaceConfig';

describe('workspaceConfig', () => {
  let dir: string;
  let config: string;
  let a: string;
  let b: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-config-'));
    config = path.join(dir, 'config.json');
    a = path.join(dir, 'quickbite');
    b = path.join(dir, 'admin-portal');
    fs.mkdirSync(path.join(a, '.specify'), { recursive: true });
    fs.mkdirSync(b);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('keeps the open project first in the recent list, without duplicates', () => {
    saveCurrentWorkspace(a, config);
    saveCurrentWorkspace(b, config);
    saveCurrentWorkspace(a, config);
    expect(readWorkspaceConfig(config)).toEqual({ lastWorkspacePath: a, recentWorkspaces: [a, b] });
  });

  it('keeps other settings in the file (e.g. written by an older CLI)', () => {
    fs.writeFileSync(config, JSON.stringify({ lastWorkspacePath: b, other: 1 }));
    saveCurrentWorkspace(a, config);
    expect(readWorkspaceConfig(config)).toMatchObject({ other: 1, lastWorkspacePath: a });
  });

  it('lists the projects with their Spec Kit and existence status', () => {
    saveCurrentWorkspace(b, config);
    saveCurrentWorkspace(path.join(dir, 'gone'), config);
    expect(listWorkspaces(a, config).map(w => [w.name, w.exists, w.specKit])).toEqual([
      ['quickbite', true, true],
      ['gone', false, false],
      ['admin-portal', true, false],
    ]);
  });

  it('forgets a project without touching the folder', () => {
    saveCurrentWorkspace(b, config);
    saveCurrentWorkspace(a, config);
    forgetWorkspace(b, config);
    expect(readWorkspaceConfig(config).recentWorkspaces).toEqual([a]);
    expect(fs.existsSync(b)).toBe(true);
  });

  it('accepts only absolute paths to existing folders', () => {
    expect(resolveWorkspaceInput(` ${a} `)).toEqual({ ok: true, path: a });
    expect(resolveWorkspaceInput(`${a}/../quickbite`)).toEqual({ ok: true, path: a });
    expect(resolveWorkspaceInput('~')).toEqual({ ok: true, path: os.homedir() });
    expect(resolveWorkspaceInput('quickbite')).toMatchObject({ ok: false, error: expect.stringContaining('full path') });
    expect(resolveWorkspaceInput(path.join(dir, 'nope'))).toMatchObject({ ok: false, error: expect.stringContaining('isn’t a folder') });
    expect(resolveWorkspaceInput(config + 'x')).toMatchObject({ ok: false });
    expect(resolveWorkspaceInput('')).toMatchObject({ ok: false });
  });
});

describe('listFolders', () => {
  it('lists visible subfolders, sorted, with Spec Kit marks and a parent', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-browse-'));
    try {
      for (const d of ['b-app', 'A-app/.specify', '.hidden', 'app10', 'app2']) fs.mkdirSync(path.join(dir, d), { recursive: true });
      fs.writeFileSync(path.join(dir, 'file.txt'), 'x');
      const l = listFolders(dir);
      expect(l.folders.map(f => [f.name, f.specKit])).toEqual([['A-app', true], ['app2', false], ['app10', false], ['b-app', false]]);
      expect(l.parent).toBe(path.dirname(l.path));
      expect(l.places[0]).toEqual({ name: 'Home', path: os.homedir() });
      expect(listFolders('/').parent).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
