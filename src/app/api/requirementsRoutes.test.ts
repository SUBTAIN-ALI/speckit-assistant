import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Point the app at a temp workspace and a temp credentials file before the DI
// container (imported by the routes) is created.
const env = vi.hoisted(() => {
  const nodeFs = require('fs') as typeof import('fs');
  const nodeOs = require('os') as typeof import('os');
  const nodePath = require('path') as typeof import('path');
  const root = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'speckit-req-routes-'));
  process.env.WORKSPACE_PATH = nodePath.join(root, 'ws');
  process.env.SPECKIT_CREDENTIALS_PATH = nodePath.join(root, 'creds', 'credentials.json');
  nodeFs.mkdirSync(nodePath.join(root, 'ws'), { recursive: true });
  return { root };
});

import { GET as getReqs, POST as postReq, PATCH as patchReq, DELETE as deleteReq } from './requirements/route';
import { GET as getSets, POST as postSet, DELETE as deleteSet } from './requirements/sets/route';
import { POST as grouping } from './requirements/grouping/route';
import { POST as createFeatures } from './requirements/features/route';
import { GET as getSettings, PUT as putSettings } from './settings/integrations/route';
import { POST as importMeeting } from './meeting/import/route';
import { POST as listModels } from './llm/models/route';
import { POST as connectZoom } from './integrations/zoom/connect/route';
import { GET as zoomCallback } from './integrations/zoom/callback/route';

const json = (method: string, body: unknown) =>
  new Request('http://localhost:18080/api/x', { method, headers: { 'Content-Type': 'application/json', host: 'localhost:18080' }, body: JSON.stringify(body) });

afterAll(() => fs.rmSync(env.root, { recursive: true, force: true }));

describe('requirements routes', () => {
  let set = '';
  const mdPath = () => path.join(process.env.WORKSPACE_PATH!, '.specify', 'meetings', set, 'requirements.md');

  it('starts with no lists, creates one, and returns null for unknown sets', async () => {
    expect(await (await getSets()).json()).toEqual({ sets: [] });
    const created = await (await postSet(json('POST', { title: 'Checkout sync' }))).json();
    set = created.id;
    expect(set).toMatch(/^\d{4}-\d{2}-\d{2}-checkout-sync$/);
    const res = await getReqs(new Request('http://localhost/api/requirements?set=missing'));
    expect(await res.json()).toEqual({ doc: null });
  });

  it('supports add, update, reorder, delete and undo, persisted as markdown', async () => {
    let res = await postReq(json('POST', { set, requirement: { title: 'Reset password', priority: 'must' } }));
    expect(res.status).toBe(200);
    expect((await res.json()).requirement.id).toBe('REQ-001');
    await postReq(json('POST', { set, requirement: { title: 'Export CSV' } }));

    res = await patchReq(json('PATCH', { set, id: 'REQ-002', patch: { status: 'accepted', acceptanceCriteria: ['Downloads a .csv'] } }));
    expect((await res.json()).doc.requirements[1]).toMatchObject({ status: 'accepted', acceptanceCriteria: ['Downloads a .csv'] });

    res = await patchReq(json('PATCH', { set, order: ['REQ-002', 'REQ-001'] }));
    expect((await res.json()).doc.requirements.map((r: any) => r.id)).toEqual(['REQ-002', 'REQ-001']);

    res = await deleteReq(new Request(`http://localhost/api/requirements?set=${set}&id=REQ-002`, { method: 'DELETE' }));
    const del = await res.json();
    expect(del.doc.requirements.map((r: any) => r.id)).toEqual(['REQ-001']);

    res = await postReq(json('POST', { set, restore: { requirement: del.removed, index: del.index } }));
    expect((await res.json()).doc.requirements.map((r: any) => r.id)).toEqual(['REQ-002', 'REQ-001']);

    const md = fs.readFileSync(mdPath(), 'utf-8');
    expect(md).toContain('## REQ-002 · Export CSV');
    expect(md).toContain('- status: accepted');

    const sets = (await (await getSets()).json()).sets;
    expect(sets[0]).toMatchObject({ id: set, title: 'Checkout sync', total: 2, accepted: 1 });
  });

  it('returns 400 for invalid input and unsafe set ids', async () => {
    expect((await postReq(json('POST', { set, requirement: { title: '' } }))).status).toBe(400);
    expect((await patchReq(json('PATCH', { set, id: 'REQ-999', patch: { title: 'x' } }))).status).toBe(400);
    expect((await getReqs(new Request('http://localhost/api/requirements?set=../../etc'))).status).toBe(400);
    expect((await deleteSet(new Request('http://localhost/api/requirements/sets?set=..', { method: 'DELETE' }))).status).toBe(400);
  });

  it('grouping needs the meetings extension (agent engine) or an AI key (direct engine)', async () => {
    expect((await grouping(json('POST', { set, ids: 'x' }))).status).toBe(400);
    // No API key saved → the agent engine is the default.
    let res = await grouping(json('POST', { set, ids: ['REQ-001'] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Meeting Requirements/);

    await putSettings(json('PUT', { engine: 'direct' }));
    res = await grouping(json('POST', { set, ids: ['REQ-001'] }));
    expect((await res.json()).error).toMatch(/API key/);
  });

  it('feature creation requires an agent and validates groups before creating anything', async () => {
    expect((await createFeatures(json('POST', { set, groups: [] }))).status).toBe(400);
    const res = await createFeatures(json('POST', { set, groups: [{ title: 'X', requirementIds: ['REQ-404'] }], agentConfig: { agentType: 'claude' } }));
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    expect(await res.text()).toContain('Unknown requirement: REQ-404');
    expect(fs.existsSync(path.join(process.env.WORKSPACE_PATH!, 'specs'))).toBe(false);
  });

  it('deletes a list', async () => {
    expect((await deleteSet(new Request(`http://localhost/api/requirements/sets?set=${set}`, { method: 'DELETE' }))).status).toBe(200);
    expect(fs.existsSync(mdPath())).toBe(false);
  });
});

describe('integration settings routes', () => {
  it('stores secrets in the credentials file but never returns them', async () => {
    const res = await putSettings(json('PUT', {
      llm: { provider: 'openai', keys: { openai: 'sk-live-very-secret-9876' } },
      zoom: { clientId: 'zoom-cid', clientSecret: 'zoom-very-secret' },
    }));
    const body = JSON.stringify(await res.json()) + JSON.stringify(await (await getSettings()).json());
    expect(body).not.toContain('very-secret');
    expect(body).toContain('…9876');
    const stored = fs.readFileSync(process.env.SPECKIT_CREDENTIALS_PATH!, 'utf-8');
    expect(stored).toContain('sk-live-very-secret-9876');
    if (process.platform !== 'win32') expect(fs.statSync(process.env.SPECKIT_CREDENTIALS_PATH!).mode & 0o777).toBe(0o600);
    // Nothing was written inside the workspace.
    expect(fs.readdirSync(process.env.WORKSPACE_PATH!).some(f => f.includes('cred'))).toBe(false);
  });

  it('rejects an unknown provider when listing models', async () => {
    expect((await listModels(json('POST', { provider: 'mistral' }))).status).toBe(400);
  });

  it('builds the Zoom authorize URL with the redirect for this origin', async () => {
    const res = await connectZoom(new Request('http://localhost:18080/api/integrations/zoom/connect', { method: 'POST', headers: { host: 'localhost:18080' } }));
    const { url } = await res.json();
    const u = new URL(url);
    expect(u.searchParams.get('client_id')).toBe('zoom-cid');
    expect(u.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:18080/api/integrations/zoom/callback');
  });

  it('bounces callback errors back to the Requirements section', async () => {
    const res = await zoomCallback(new Request('http://127.0.0.1:18080/api/integrations/zoom/callback?error=access_denied', { headers: { host: '127.0.0.1:18080' } }));
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get('location')!);
    // Back to where sign-in started (localhost), not the 127.0.0.1 callback host.
    expect(loc.origin).toBe('http://localhost:18080');
    expect(loc.searchParams.get('section')).toBe('requirements');
    expect(loc.searchParams.get('zoom')).toBe('error');

    const forged = await zoomCallback(new Request('http://localhost:18080/api/integrations/zoom/callback?code=c&state=forged', { headers: { host: 'localhost:18080' } }));
    expect(new URL(forged.headers.get('location')!).searchParams.get('message')).toMatch(/expired|didn’t come from this app/);
  });
});

describe('meeting import route', () => {
  const readSse = async (res: Response) => {
    const text = await res.text();
    return text.split('\n\n').filter(Boolean).map(block => ({
      event: /^event: (.*)$/m.exec(block)?.[1],
      data: JSON.parse(/^data: (.*)$/m.exec(block)?.[1] ?? 'null'),
    }));
  };

  it('validates the request body', async () => {
    expect((await importMeeting(json('POST', {}))).status).toBe(400);
    expect((await importMeeting(json('POST', { transcript: 'x'.repeat(5 * 1024 * 1024 + 1) }))).status).toBe(413);
  });

  it('streams a done event with the outcome (unsupported link fails fast)', async () => {
    const res = await importMeeting(json('POST', { link: 'https://zoom.us/rec/share/abc' }));
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    const events = await readSse(res);
    expect(events.at(-1)).toMatchObject({ event: 'done', data: { status: 'unsupported_link' } });
  });

  it('asks to connect Zoom before fetching a meeting (no network call)', async () => {
    const events = await readSse(await importMeeting(json('POST', { link: '85012345678' })));
    expect(events.at(-1)).toMatchObject({ event: 'done', data: { status: 'auth_required' } });
  });
});

describe('zoom sign-in through a public tunnel', () => {
  it('sends the configured https callback to Zoom and returns the user to localhost', async () => {
    await putSettings(json('PUT', { zoom: { callbackUrl: 'https://abc.ngrok-free.app' } }));
    const res = await connectZoom(new Request('http://localhost:3000/api/integrations/zoom/connect', { method: 'POST', headers: { host: 'localhost:3000' } }));
    expect(new URL((await res.json()).url).searchParams.get('redirect_uri')).toBe('https://abc.ngrok-free.app/api/integrations/zoom/callback');

    // Zoom redirects the browser to the tunnel; Host is the tunnel's.
    const cb = await zoomCallback(new Request('https://abc.ngrok-free.app/api/integrations/zoom/callback?error=access_denied', { headers: { host: 'abc.ngrok-free.app' } }));
    expect(new URL(cb.headers.get('location')!).origin).toBe('http://localhost:3000');
  });
});
