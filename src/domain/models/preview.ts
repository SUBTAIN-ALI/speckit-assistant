// Live preview of the open project: the coding agent works out how to run it
// (once, saved to .specify/preview.json), and the app runs that command and
// shows the page next to the board.

export const PREVIEW_CONFIG_FILE = '.specify/preview.json';

export type PreviewConfig = {
  command: string; // foreground dev-server command, e.g. "pnpm dev"; "{port}" is replaced with the port
  cwd?: string; // folder to run it in, relative to the project ("" = the project root)
  port?: number; // the port the server usually listens on
  path?: string; // page to open, e.g. "/signup"
  notes?: string; // what the agent set up (env files, installs…)
};

export type PreviewState = 'stopped' | 'starting' | 'running' | 'failed';

export type PreviewStatus = {
  state: PreviewState;
  url?: string; // where the server answers, e.g. http://localhost:5173
  command?: string;
  logs: string; // the server's recent output (ANSI stripped)
  error?: string;
  startedAt?: number;
};

export const STOPPED: PreviewStatus = { state: 'stopped', logs: '' };

export function parsePreviewConfig(raw: string): { ok: true; value: PreviewConfig } | { ok: false; error: string } {
  let v: any;
  try {
    v = JSON.parse(raw);
  } catch {
    return { ok: false, error: `${PREVIEW_CONFIG_FILE} isn’t valid JSON.` };
  }
  if (!v || typeof v !== 'object' || typeof v.command !== 'string' || !v.command.trim()) {
    return { ok: false, error: `${PREVIEW_CONFIG_FILE} needs a "command".` };
  }
  const cwdInput = typeof v.cwd === 'string' ? v.cwd.trim() : '';
  const cwd = cwdInput === '.' ? '' : cwdInput.replace(/^\.\//, '');
  if (cwd.startsWith('/') || cwd.split(/[\\/]/).includes('..')) {
    return { ok: false, error: `"cwd" in ${PREVIEW_CONFIG_FILE} must be a folder inside the project.` };
  }
  const port = Number(v.port);
  return {
    ok: true,
    value: {
      command: v.command.trim(),
      ...(cwd ? { cwd } : {}),
      ...(Number.isInteger(port) && port > 0 && port < 65536 ? { port } : {}),
      ...(typeof v.path === 'string' && v.path.trim() ? { path: normalizePath(v.path) } : {}),
      ...(typeof v.notes === 'string' && v.notes.trim() ? { notes: v.notes.trim() } : {}),
    },
  };
}

export function normalizePath(p: string): string {
  const t = p.trim();
  return t.startsWith('/') ? t : `/${t}`;
}

// The local address a dev server prints when it's ready ("Local: http://localhost:5173/",
// "ready on http://0.0.0.0:3001", "Running on http://127.0.0.1:8000"). Wildcard
// hosts become localhost, which the browser can open.
export function findServerUrl(output: string): string | null {
  const m = /https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|\[::\])(:\d{2,5})\/?/i.exec(stripAnsi(output));
  if (!m) return null;
  const host = /^(0\.0\.0\.0|\[::\])$/.test(m[1]) ? 'localhost' : m[1];
  return `${m[0].startsWith('https') ? 'https' : 'http'}://${host}${m[2]}`;
}

export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
}
