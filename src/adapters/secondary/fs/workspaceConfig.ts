import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ~/.speckit-assistant-config.json: the open project (workspace) and the
// projects opened before, for the header's project switcher and the CLI.

export type WorkspaceConfig = { lastWorkspacePath?: string; recentWorkspaces?: string[] };

export type WorkspaceInfo = {
  path: string;
  name: string; // folder name
  exists: boolean;
  specKit: boolean; // `specify init` has been run (.specify/ exists)
};

const MAX_RECENT = 10;

export const defaultConfigPath = () => path.join(os.homedir(), '.speckit-assistant-config.json');

export function readWorkspaceConfig(configPath = defaultConfigPath()): WorkspaceConfig {
  try {
    const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

// Makes `workspacePath` the open project and moves it to the top of the recent list.
export function saveCurrentWorkspace(workspacePath: string, configPath = defaultConfigPath()): void {
  const config = readWorkspaceConfig(configPath);
  const recent = [workspacePath, ...(config.recentWorkspaces ?? []).filter(p => p !== workspacePath)].slice(0, MAX_RECENT);
  writeConfig(configPath, { ...config, lastWorkspacePath: workspacePath, recentWorkspaces: recent });
}

export function forgetWorkspace(workspacePath: string, configPath = defaultConfigPath()): void {
  const config = readWorkspaceConfig(configPath);
  writeConfig(configPath, { ...config, recentWorkspaces: (config.recentWorkspaces ?? []).filter(p => p !== workspacePath) });
}

// The open project plus the recent ones (the open one first, never twice).
export function listWorkspaces(current: string, configPath = defaultConfigPath()): WorkspaceInfo[] {
  const recent = readWorkspaceConfig(configPath).recentWorkspaces ?? [];
  return [current, ...recent.filter(p => p !== current)].map(describeWorkspace);
}

export function describeWorkspace(workspacePath: string): WorkspaceInfo {
  const exists = isDirectory(workspacePath);
  return {
    path: workspacePath,
    name: path.basename(workspacePath) || workspacePath,
    exists,
    specKit: exists && isDirectory(path.join(workspacePath, '.specify')),
  };
}

// A folder typed by the user: "~/…" expanded; must be an absolute path to an existing directory.
export function resolveWorkspaceInput(input: string): { ok: true; path: string } | { ok: false; error: string } {
  const raw = input.trim();
  if (!raw) return { ok: false, error: 'Enter the project folder’s path.' };
  const expanded = raw === '~' || raw.startsWith('~/') ? path.join(os.homedir(), raw.slice(1)) : raw;
  if (!path.isAbsolute(expanded)) return { ok: false, error: 'Use a full path, e.g. ~/Projects/my-app or /Users/you/Projects/my-app.' };
  const resolved = path.resolve(expanded);
  if (!isDirectory(resolved)) return { ok: false, error: `${resolved} isn’t a folder on this computer.` };
  return { ok: true, path: resolved };
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function writeConfig(configPath: string, config: WorkspaceConfig): void {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  } catch {
    // best-effort, like the CLI's own save
  }
}

export type FolderListing = {
  path: string;
  parent: string | null; // null at the filesystem root
  specKit: boolean;
  folders: Array<{ name: string; path: string; specKit: boolean }>;
  places: Array<{ name: string; path: string }>; // shortcuts: Home, Projects, Desktop…
};

const MAX_FOLDERS = 1000;

// The subfolders of `dir` for the project picker (names only; hidden folders skipped).
export function listFolders(dir: string): FolderListing {
  const resolved = path.resolve(dir);
  const entries = fs.readdirSync(resolved, { withFileTypes: true });
  const folders = entries
    .filter(e => !e.name.startsWith('.') && (e.isDirectory() || (e.isSymbolicLink() && isDirectory(path.join(resolved, e.name)))))
    .map(e => e.name)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }))
    .slice(0, MAX_FOLDERS)
    .map(name => {
      const p = path.join(resolved, name);
      return { name, path: p, specKit: isDirectory(path.join(p, '.specify')) };
    });
  const parent = path.dirname(resolved);
  const home = os.homedir();
  const places = [
    { name: 'Home', path: home },
    ...['Projects', 'Developer', 'Code', 'Documents', 'Desktop']
      .map(name => ({ name, path: path.join(home, name) }))
      .filter(p => isDirectory(p.path)),
  ];
  return {
    path: resolved,
    parent: parent === resolved ? null : parent,
    specKit: isDirectory(path.join(resolved, '.specify')),
    folders,
    places,
  };
}
