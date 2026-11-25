import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EpsError } from '../../../domain/models/eps';
const service = vi.hoisted(() => ({ view: vi.fn(), configure: vi.fn(), test: vi.fn(), discover: vi.fn(), sync: vi.fn(), importRequirement: vi.fn(), postMessage: vi.fn(), report: vi.fn(), applyAnswer: vi.fn(), resolveConflict: vi.fn(), resolveWrite: vi.fn() }));
vi.mock('../../../adapters/di', () => ({ epsService: service }));
vi.mock('../../../adapters/primary/api/utils', () => ({ getWorkspacePath: () => '/current-project' }));
import { GET, POST, PUT } from './route';
const req = (body: unknown) => new Request('http://localhost/api/eps', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
beforeEach(() => vi.resetAllMocks());
describe('EPS routes', () => {
  it('uses the selected workspace and returns only the safe settings view', async () => {
    service.view.mockResolvedValue({ configured: true, environment: 'staging' });
    expect(await (await GET()).json()).toEqual({ configured: true, environment: 'staging' });
    expect(service.view).toHaveBeenCalledWith('/current-project');
    await PUT(req({ token: 'eps_mcp_secret' }));
    expect(service.configure).toHaveBeenCalledWith('/current-project', { token: 'eps_mcp_secret' });
  });
  it('imports a chosen requirement and routes conversation actions', async () => {
    service.importRequirement.mockResolvedValue('eps-set');
    expect(await (await POST(req({ action: 'import', id: 'chosen' }))).json()).toEqual({ setId: 'eps-set' });
    await POST(req({ action: 'message', id: 'chosen', type: 'question', body: 'CSV?' }));
    expect(service.postMessage).toHaveBeenCalledWith('/current-project', 'chosen', 'question', 'CSV?');
  });
  it('maps auth failures and does not expose unexpected errors', async () => {
    service.test.mockRejectedValue(new EpsError('Replace EPS token', 'auth'));
    const denied = await POST(req({ action: 'test' })); expect(denied.status).toBe(401);
    service.view.mockRejectedValue(new Error('secret eps_mcp_private'));
    const failed = await GET(); expect(failed.status).toBe(500);
    expect(JSON.stringify(await failed.json())).not.toContain('eps_mcp_private');
    expect((await POST(req({ action: 'unknown' }))).status).toBe(400);
  });
});
