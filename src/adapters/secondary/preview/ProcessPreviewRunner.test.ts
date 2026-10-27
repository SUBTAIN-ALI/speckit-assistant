import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as net from 'net';
import { ProcessPreviewRunner } from './ProcessPreviewRunner';

// Real child processes: tiny node servers standing in for dev servers.
const node = JSON.stringify(process.execPath);
const serverUsingPORT = `${node} -e "require('http').createServer((q,s)=>s.end('hi')).listen(process.env.PORT,()=>console.log('ready on http://localhost:'+process.env.PORT))"`;
// Like Vite: ignores PORT, picks its own port and prints it.
const serverPrintingOwnPort = `${node} -e "const s=require('http').createServer((q,r)=>r.end('vite'));s.listen(0,'127.0.0.1',()=>console.log('  Local:   http://localhost:'+s.address().port+'/'))"`;

const waitFor = async (check: () => boolean, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise(r => setTimeout(r, 50));
  }
};
const portOpen = (url: string) => new Promise<boolean>(resolve => {
  const { port } = new URL(url);
  const sock = net.connect(Number(port), '127.0.0.1', () => { sock.end(); resolve(true); });
  sock.on('error', () => resolve(false));
});

// Real processes are slower when the whole suite runs in parallel.
describe('ProcessPreviewRunner', { timeout: 30_000 }, () => {
  const runner = new ProcessPreviewRunner(8_000, 100);
  let ws: string;
  afterEach(async () => {
    await runner.stopAll();
    if (ws) fs.rmSync(ws, { recursive: true, force: true });
  });
  const workspace = () => (ws = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-ws-')));

  it('runs the command with a free PORT and reports where it answers', async () => {
    const dir = workspace();
    await runner.start(dir, { command: serverUsingPORT });
    await waitFor(() => runner.status(dir).state === 'running');
    const s = runner.status(dir);
    expect(s.url).toMatch(/^http:\/\/localhost:\d+$/);
    expect(s.logs).toContain('ready on');

    await runner.stop(dir);
    expect(runner.status(dir).state).toBe('stopped');
    expect(await portOpen(s.url!)).toBe(false); // the server really stopped
  });

  it('follows the address a server prints when it ignores PORT', async () => {
    const dir = workspace();
    await runner.start(dir, { command: serverPrintingOwnPort });
    await waitFor(() => runner.status(dir).state === 'running');
    expect(runner.status(dir).logs).toContain(runner.status(dir).url!.split(':').pop());
  });

  it('runs in the configured folder and fills in {port}', async () => {
    const dir = workspace();
    fs.mkdirSync(path.join(dir, 'web'));
    await runner.start(dir, { command: `${node} -e "console.log(process.cwd());require('http').createServer((q,s)=>s.end()).listen(Number(process.argv[1]))" {port}`, cwd: 'web' });
    await waitFor(() => runner.status(dir).state === 'running');
    expect(runner.status(dir).logs).toContain(`${path.sep}web`);
  });

  it('fails with the output when the command exits early', async () => {
    const dir = workspace();
    await runner.start(dir, { command: `${node} -e "console.error('Error: Cannot find module next');process.exit(1)"` });
    await waitFor(() => runner.status(dir).state === 'failed');
    expect(runner.status(dir).error).toContain('exited before the server was ready');
    expect(runner.status(dir).logs).toContain('Cannot find module next');
  });

  it('fails when nothing answers in time', async () => {
    const slow = new ProcessPreviewRunner(600, 100);
    const dir = workspace();
    await slow.start(dir, { command: `${node} -e "setTimeout(()=>{},60000)"` });
    await waitFor(() => slow.status(dir).state === 'failed', 5_000);
    expect(slow.status(dir).error).toContain('didn’t answer');
    await slow.stopAll();
  });
});
