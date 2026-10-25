import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { hostnameOf, isAllowedHost, isAllowedOrigin, isPublicRoute, middleware } from './middleware';

describe('middleware', () => {
  it('parses hostnames from Host headers', () => {
    expect(hostnameOf('localhost:18080')).toBe('localhost');
    expect(hostnameOf('[::1]:18080')).toBe('[::1]');
    expect(hostnameOf('127.0.0.1')).toBe('127.0.0.1');
    expect(hostnameOf(null)).toBe('');
  });

  it('allows loopback hosts only (blocks DNS rebinding)', () => {
    for (const h of ['localhost:18080', '127.0.0.1:3000', '[::1]:18080', 'LOCALHOST']) expect(isAllowedHost(h, '')).toBe(true);
    for (const h of ['evil.example.com', 'localhost.evil.com:18080', '192.168.1.10:18080', '', null]) expect(isAllowedHost(h, '')).toBe(false);
    expect(isAllowedHost('devbox:18080', 'devbox, other')).toBe(true);
  });

  it('rejects cross-site state-changing requests (CSRF)', () => {
    expect(isAllowedOrigin('GET', 'https://evil.example.com', '')).toBe(true);
    expect(isAllowedOrigin('POST', null, '')).toBe(true);
    expect(isAllowedOrigin('POST', 'http://localhost:18080', '')).toBe(true);
    expect(isAllowedOrigin('POST', 'https://evil.example.com', '')).toBe(false);
    expect(isAllowedOrigin('PUT', 'null', '')).toBe(false);
    expect(isAllowedOrigin('DELETE', 'not a url', '')).toBe(false);
  });

  it('returns 403 for bad hosts and origins, passes good requests', () => {
    const req = (headers: Record<string, string>, method = 'POST') =>
      new NextRequest('http://localhost:18080/api/settings/integrations', { method, headers });
    expect(middleware(req({ host: 'evil.example.com' })).status).toBe(403);
    expect(middleware(req({ host: 'localhost:18080', origin: 'https://evil.example.com' })).status).toBe(403);
    expect(middleware(req({ host: 'localhost:18080', origin: 'http://localhost:18080' })).status).toBe(200);
  });

  it('explains local-only access on pages opened from a network address', async () => {
    const res = middleware(new NextRequest('http://192.168.1.20:3000/', { headers: { host: '192.168.1.20:3000' } }));
    expect(res.status).toBe(403);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('http://localhost:3000');
    expect(html).toContain('SPECKIT_ALLOWED_HOSTS=192.168.1.20');
    // Pages on a local host are served; the Origin check applies to the API only.
    expect(middleware(new NextRequest('http://localhost:3000/', { headers: { host: 'localhost:3000' } })).status).toBe(200);
  });

  it('lets a public tunnel host reach only the Zoom OAuth callback (GET)', () => {
    const tunnel = (path: string, method = 'GET') =>
      middleware(new NextRequest(`https://abc.ngrok.app${path}`, { method, headers: { host: 'abc.ngrok.app' } }));
    expect(tunnel('/api/integrations/zoom/callback?code=c&state=s').status).toBe(200);
    expect(tunnel('/api/integrations/zoom/callback', 'POST').status).toBe(403);
    expect(tunnel('/api/settings/integrations').status).toBe(403);
    expect(tunnel('/').status).toBe(403);
    expect(isPublicRoute('GET', '/api/integrations/zoom/callback/')).toBe(false);
  });
});
