import { describe, it, expect } from 'vitest';
import { RequirementsService } from './RequirementsService';
import { MemoryWorkspace } from '../../test/meetingFakes';
import { parseRequirements, serializeRequirements } from './requirementsMarkdown';
import { appendRequirements } from './requirementsOps';
import { emptyRequirementsDoc } from './requirementsMarkdown';

const NOW = Date.UTC(2026, 9, 25);
const make = (ws = new MemoryWorkspace(), onLinked?: (ws: string, f: string) => Promise<void>) =>
  ({ ws, svc: new RequirementsService(ws, onLinked, () => NOW) });

describe('RequirementsService', () => {
  it('creates sets with date-based unique ids and lists them newest first', async () => {
    const { svc } = make();
    const a = await svc.create('/ws', 'Checkout sync');
    const b = await svc.create('/ws', 'Checkout sync');
    expect([a.id, b.id]).toEqual(['2026-10-25-checkout-sync', '2026-10-25-checkout-sync-2']);
    expect(await svc.newSetId('/ws', 'Ünïcode & Stuff!', '2026-09-01T10:00:00Z')).toBe('2026-09-01-unicode-stuff');
    expect(await svc.newSetId('/ws', '!!!')).toBe('2026-10-25-meeting');

    await svc.add('/ws', a.id, { title: 'Login', status: 'accepted' });
    await svc.add('/ws', a.id, { title: 'Logout', feature: '005-auth' });
    const list = await svc.list('/ws');
    expect(list.map(s => s.id)).toEqual([b.id, a.id]);
    expect(list.find(s => s.id === a.id)).toMatchObject({ title: 'Checkout sync', source: 'manual', total: 2, accepted: 1, draft: 1, linked: 1 });
  });

  it('round-trips CRUD through markdown', async () => {
    const { ws, svc } = make();
    const { id } = await svc.create('/ws', 'List');
    expect((await svc.add('/ws', id, { title: 'Login', priority: 'must' })).requirement.id).toBe('REQ-001');
    expect(ws.files.get(`.specify/meetings/${id}/requirements.md`)).toContain('## REQ-001 · Login');
    await svc.add('/ws', id, { title: 'Logout' });
    await svc.update('/ws', id, 'REQ-002', { status: 'accepted' });
    const { removed, index } = await svc.remove('/ws', id, 'REQ-001');
    await svc.restore('/ws', id, removed, index);
    const doc = await svc.reorder('/ws', id, ['REQ-002', 'REQ-001']);
    expect(doc.requirements.map(r => [r.id, r.status])).toEqual([['REQ-002', 'accepted'], ['REQ-001', 'draft']]);
  });

  it('deletes a set and its meeting files, not other sets', async () => {
    const { ws, svc } = make();
    const a = await svc.create('/ws', 'A');
    const b = await svc.create('/ws', 'B');
    ws.files.set(`.specify/meetings/${a.id}/transcript.md`, 't');
    await svc.deleteSet('/ws', a.id);
    expect([...ws.files.keys()].some(k => k.includes(a.id))).toBe(false);
    expect(await svc.get('/ws', b.id)).not.toBeNull();
  });

  it('refreshes the feature copy and flags the spec when a linked requirement changes', async () => {
    const stale: string[] = [];
    const { ws, svc } = make(new MemoryWorkspace(), async (_w, f) => { stale.push(f); });
    const setId = '2026-10-25-sync';
    const doc = appendRequirements(emptyRequirementsDoc({ title: 'Sync', meetingTopic: 'Weekly' }), [
      { title: 'Reset password', feature: '005-auth', status: 'accepted' },
      { title: 'Lockout', feature: '005-auth', status: 'accepted' },
      { title: 'CSV export', status: 'accepted' },
    ]);
    await svc.save('/ws', setId, doc);
    await svc.writeFeatureCopy('/ws', setId, doc, '005-auth', 'Authentication');

    // Status-only change: the spec is unaffected.
    await svc.update('/ws', setId, 'REQ-001', { status: 'draft' });
    expect(stale).toEqual([]);

    await svc.update('/ws', setId, 'REQ-001', { title: 'Reset password by email' });
    expect(stale).toEqual(['005-auth']);
    const copy = parseRequirements(ws.files.get('specs/005-auth/requirements.md')!);
    expect(copy.meta).toMatchObject({ title: 'Authentication', setId });
    expect(copy.requirements.map(r => r.title)).toEqual(['Reset password by email', 'Lockout']);

    // Unlinking removes it from the copy; deleting a linked one does too.
    await svc.update('/ws', setId, 'REQ-002', { feature: '' });
    await svc.remove('/ws', setId, 'REQ-001');
    expect(parseRequirements(ws.files.get('specs/005-auth/requirements.md')!).requirements).toEqual([]);
    expect(stale).toEqual(['005-auth', '005-auth', '005-auth']);
  });

  it('picks up hand edits made on disk', async () => {
    const { ws, svc } = make();
    ws.files.set('.specify/meetings/s1/requirements.md', '## REQ-007 · Typed by hand\n- feature: 004-x\n');
    expect((await svc.get('/ws', 's1'))!.requirements[0].feature).toBe('004-x');
    const { requirement } = await svc.add('/ws', 's1', { title: 'Next' });
    expect(requirement.id).toBe('REQ-008');
  });

  it('rejects unsafe set ids and missing sets', async () => {
    const { svc } = make();
    for (const bad of ['../x', 'a/b', '', '.hidden', 'a..b']) {
      await expect(svc.get('/ws', bad)).rejects.toThrow(/Invalid requirement set/);
    }
    await expect(svc.add('/ws', 'missing', { title: 'x' })).rejects.toThrow(/not found/);
  });

  it('serializes the feature link', () => {
    const md = serializeRequirements(appendRequirements(emptyRequirementsDoc(), [{ title: 'A', feature: '005-auth' }]));
    expect(md).toContain('- feature: 005-auth');
  });
});
