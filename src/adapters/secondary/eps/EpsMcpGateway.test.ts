import { afterEach, describe, expect, it, vi } from 'vitest';
import { EpsMcpGateway, epsToolPayload } from './EpsMcpGateway';

describe('EPS stateless MCP transport', () => {
  afterEach(() => vi.unstubAllGlobals());
  const secrets = { get: async () => 'eps_mcp_secret', set: async () => {} };
  it('negotiates MCP and parses JSON text without a session or SSE stream', async () => {
    const methods: string[] = [];
    const fetcher = vi.fn(async (_url: unknown, init: RequestInit) => {
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer eps_mcp_secret');
      if (init.method === 'GET') return new Response('', { status: 405 });
      const body = JSON.parse(String(init.body)); methods.push(body.method);
      if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
      const result = body.method === 'initialize'
        ? { protocolVersion: '2025-03-26', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'EPS Requirements', version: '1.0.0' } }
        : { content: [{ type: 'text', text: JSON.stringify([{ id: 'example' }]) }], isError: false };
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), { headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetcher);
    expect(await new EpsMcpGateway(secrets).call('staging', 'list_released_requirements', {})).toEqual([{ id: 'example' }]);
    expect(methods).toEqual(['initialize', 'notifications/initialized', 'tools/call']);
  });
  it('does not retry unauthorized tokens or expose the remote error body', async () => {
    const fetcher = vi.fn(async () => new Response('private token eps_mcp_secret', { status: 401 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(new EpsMcpGateway(secrets).call('production', 'get_requirement', {})).rejects.toMatchObject({ kind: 'auth' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects tool errors before JSON parsing and rejects malformed successful content', () => {
    expect(() => epsToolPayload({ isError: true, content: [{ type: 'text', text: 'private backend details' }] })).toThrow(/rejected/);
    expect(() => epsToolPayload({ content: [{ type: 'text', text: 'not JSON' }] })).toThrow(/invalid JSON/);
  });
  it('requires all six documented tools during connection testing', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: RequestInit) => {
      if (init.method === 'GET') return new Response('', { status: 405 });
      const body = JSON.parse(String(init.body));
      if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: body.method === 'initialize'
        ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'EPS', version: '1' } }
        : { tools: [] } }), { headers: { 'Content-Type': 'application/json' } });
    }));
    await expect(new EpsMcpGateway(secrets).test('staging')).rejects.toThrow(/missing the required tool/);
  });
});
