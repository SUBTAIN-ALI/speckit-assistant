import { describe, it, expect } from 'vitest';
import { zoomRedirectUriFor, isLoopbackHost } from './zoomRedirect';

describe('zoomRedirectUriFor', () => {
  it('rewrites local origins to 127.0.0.1 (Zoom rejects "localhost")', () => {
    expect(zoomRedirectUriFor('http://localhost:3000')).toBe('http://127.0.0.1:3000/api/integrations/zoom/callback');
    expect(zoomRedirectUriFor('http://127.0.0.1:18080')).toBe('http://127.0.0.1:18080/api/integrations/zoom/callback');
    expect(zoomRedirectUriFor('http://[::1]:18080')).toBe('http://127.0.0.1:18080/api/integrations/zoom/callback');
    expect(zoomRedirectUriFor('http://localhost')).toBe('http://127.0.0.1/api/integrations/zoom/callback');
  });
  it('keeps explicitly allowed non-loopback hosts as-is', () => {
    expect(zoomRedirectUriFor('http://devbox:3000')).toBe('http://devbox:3000/api/integrations/zoom/callback');
    expect(isLoopbackHost('LOCALHOST')).toBe(true);
    expect(isLoopbackHost('example.com')).toBe(false);
  });
});
