import { ChildProcess, spawn } from 'child_process';
import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import * as path from 'path';
import { PreviewConfig, PreviewStatus, STOPPED, findServerUrl, stripAnsi } from '../../../domain/models/preview';
import { PreviewRunnerPort } from '../../../domain/ports/out/PreviewRunnerPort';

// Runs a project's dev server for the preview: the command from
// .specify/preview.json in the project's folder, with a free PORT. It is
// "running" once the address it prints (or the port) answers HTTP.

const IS_WIN = process.platform === 'win32';
const MAX_LOG_CHARS = 60_000;

type Entry = {
  child: ChildProcess;
  status: PreviewStatus;
  timer?: NodeJS.Timeout;
};

// Global symbol: survives module reloads, like the shared entries map.
const EXIT_HOOKED = Symbol.for('speckit.preview.exitHooked');

export class ProcessPreviewRunner implements PreviewRunnerPort {
  // entries: the running dev servers. Pass a shared map to keep them across a
  // fresh runner (e.g. `next dev` reloading this module with new code).
  constructor(
    private readyTimeoutMs = 180_000,
    private pollMs = 1_000,
    private entries = new Map<string, Entry>()
  ) {
    // Don't leave dev servers behind when the app stops — once per map, not per runner.
    const hooked = entries as Map<string, Entry> & { [EXIT_HOOKED]?: true };
    if (!hooked[EXIT_HOOKED]) {
      hooked[EXIT_HOOKED] = true;
      process.once('exit', () => { for (const e of entries.values()) killTree(e.child, 'SIGKILL'); });
    }
  }

  status(workspacePath: string): PreviewStatus {
    return this.entries.get(workspacePath)?.status ?? STOPPED;
  }

  async start(workspacePath: string, config: PreviewConfig): Promise<PreviewStatus> {
    await this.stop(workspacePath);
    const port = config.port && (await isPortFree(config.port)) ? config.port : await freePort();
    const command = config.command.replace(/\{port\}/g, String(port));
    const cwd = path.join(workspacePath, config.cwd ?? '');

    const child = spawn(IS_WIN ? 'cmd.exe' : '/bin/sh', IS_WIN ? ['/d', '/s', '/c', command] : ['-c', command], {
      cwd,
      env: {
        ...process.env,
        PORT: String(port),
        BROWSER: 'none', // don't let the dev server open a browser tab
        FORCE_COLOR: '0',
        NODE_ENV: 'development',
      },
      detached: !IS_WIN, // its own process group, so stop() ends the whole tree
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const entry: Entry = { child, status: { state: 'starting', command, logs: `$ ${command}\n`, startedAt: Date.now() } };
    this.entries.set(workspacePath, entry);

    let printedUrl: string | null = null;
    const onOutput = (chunk: Buffer) => {
      const text = stripAnsi(chunk.toString('utf-8'));
      entry.status.logs = (entry.status.logs + text).slice(-MAX_LOG_CHARS);
      printedUrl ??= findServerUrl(text);
    };
    child.stdout?.on('data', onOutput);
    child.stderr?.on('data', onOutput);

    child.on('error', err => this.fail(entry, `Couldn’t run the command: ${err.message}`));
    child.on('exit', (code, signal) => {
      if (entry.timer) clearInterval(entry.timer);
      // Stopped by the user, or already failed (e.g. timed out and killed): keep that reason.
      if (this.entries.get(workspacePath) !== entry || entry.status.state === 'stopped' || entry.status.state === 'failed') return;
      this.fail(entry, entry.status.state === 'running'
        ? `The server stopped (${signal ?? `exit code ${code}`}).`
        : `The command exited before the server was ready (${signal ?? `exit code ${code}`}).`);
    });

    // Ready = the printed address, or the port we gave it, answers.
    const deadline = Date.now() + this.readyTimeoutMs;
    entry.timer = setInterval(async () => {
      if (entry.status.state !== 'starting') return;
      if (Date.now() > deadline) {
        this.fail(entry, `The server didn’t answer within ${Math.round(this.readyTimeoutMs / 1000)}s.`);
        killTree(child, 'SIGTERM');
        return;
      }
      const candidates = [...new Set([printedUrl, `http://localhost:${port}`, `http://127.0.0.1:${port}`].filter((u): u is string => !!u))];
      for (const url of candidates) {
        if (await answers(url)) {
          if (entry.status.state === 'starting') {
            entry.status = { ...entry.status, state: 'running', url: url.replace('127.0.0.1', 'localhost') };
            if (entry.timer) clearInterval(entry.timer);
          }
          return;
        }
      }
    }, this.pollMs);

    return entry.status;
  }

  async stop(workspacePath: string): Promise<void> {
    const entry = this.entries.get(workspacePath);
    if (!entry) return;
    if (entry.timer) clearInterval(entry.timer);
    entry.status = { ...entry.status, state: 'stopped', url: undefined };
    this.entries.delete(workspacePath);
    if (entry.child.exitCode !== null || entry.child.signalCode !== null) return;
    killTree(entry.child, 'SIGTERM');
    await new Promise<void>(resolve => {
      const force = setTimeout(() => { killTree(entry.child, 'SIGKILL'); resolve(); }, 3_000);
      entry.child.once('exit', () => { clearTimeout(force); resolve(); });
    });
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.entries.keys()].map(ws => this.stop(ws)));
  }

  private fail(entry: Entry, error: string) {
    if (entry.timer) clearInterval(entry.timer);
    entry.status = { ...entry.status, state: 'failed', url: undefined, error };
  }
}

function killTree(child: ChildProcess, signal: NodeJS.Signals) {
  if (!child.pid) return;
  try {
    if (IS_WIN) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    else process.kill(-child.pid, signal); // the whole process group (npm → node → vite…)
  } catch {
    try { child.kill(signal); } catch { /* already gone */ }
  }
}

// Any HTTP answer counts (a 404 or a redirect still means the server is up).
function answers(url: string): Promise<boolean> {
  return new Promise(resolve => {
    const req = (url.startsWith('https') ? https : http).get(url, { timeout: 1_500, rejectUnauthorized: false } as https.RequestOptions, res => {
      res.resume();
      resolve(true);
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}
