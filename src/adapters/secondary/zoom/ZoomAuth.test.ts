import { describe, it, expect, beforeEach } from 'vitest';
import * as crypto from 'crypto';
import { ZoomAuth, ZoomAuthError, createPkcePair, ZOOM_TOKEN_URL, ZOOM_REVOKE_URL } from './ZoomAuth';
import { MemoryCredentials } from '../../../test/meetingFakes';
import { MeetingSourceError } from '../../../domain/ports/out/MeetingSourcePort';

type Call = { url: string; init?: RequestInit };

function fakeFetch(handler: (url: string, body: URLSearchParams, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return handler(url, new URLSearchParams(String(init?.body ?? '')), init);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('ZoomAuth', () => {
  let store: MemoryCredentials;
  let now: number;
  beforeEach(() => {
    store = new MemoryCredentials({ zoom: { clientId: 'cid', clientSecret: 'csecret' } });
    now = 1_000_000;
  });

  it('creates a valid S256 PKCE pair', () => {
    const { verifier, challenge } = createPkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const expected = crypto.createHash('sha256').update(verifier).digest('base64url');
    expect(challenge).toBe(expected);
  });

  it('runs the full authorization-code + PKCE flow', async () => {
    const { fn, calls } = fakeFetch((url, body) => {
      if (url === ZOOM_TOKEN_URL) {
        expect(body.get('grant_type')).toBe('authorization_code');
        expect(body.get('code')).toBe('the-code');
        expect(body.get('redirect_uri')).toBe('http://localhost:18080/api/integrations/zoom/callback');
        expect(body.get('code_verifier')).toBeTruthy();
        return json({ access_token: 'at1', refresh_token: 'rt1', expires_in: 3600, scope: 'meeting:read:assets' });
      }
      return json({ first_name: 'Ada', last_name: 'L', email: 'ada@example.com' });
    });
    const auth = new ZoomAuth(store, fn, () => now);
    const authorizeUrl = new URL(await auth.beginAuthorization('http://localhost:18080/api/integrations/zoom/callback', 'http://localhost:3000'));
    expect(await auth.pendingReturnOrigin()).toBe('http://localhost:3000');
    expect(authorizeUrl.origin + authorizeUrl.pathname).toBe('https://zoom.us/oauth/authorize');
    expect(authorizeUrl.searchParams.get('client_id')).toBe('cid');
    expect(authorizeUrl.searchParams.get('code_challenge_method')).toBe('S256');
    const state = authorizeUrl.searchParams.get('state')!;

    await auth.completeAuthorization('the-code', state);
    expect(calls[0].init?.headers).toMatchObject({ Authorization: 'Basic ' + Buffer.from('cid:csecret').toString('base64') });
    expect(store.data.zoom).toMatchObject({
      tokens: { accessToken: 'at1', refreshToken: 'rt1', expiresAt: now + 3_600_000, scope: 'meeting:read:assets' },
      account: { name: 'Ada L', email: 'ada@example.com' },
    });
    expect(store.data.zoom?.pendingAuth).toBeUndefined();
    expect(await auth.getAccessToken()).toBe('at1');
  });

  it('rejects a wrong or expired state', async () => {
    const auth = new ZoomAuth(store, fakeFetch(() => json({})).fn, () => now);
    await auth.beginAuthorization('http://localhost/cb');
    await expect(auth.completeAuthorization('c', 'forged')).rejects.toMatchObject({ code: 'invalid_state' });
    const url = new URL(await auth.beginAuthorization('http://localhost/cb'));
    now += 11 * 60_000;
    await expect(auth.completeAuthorization('c', url.searchParams.get('state')!)).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('requires client id and secret', async () => {
    const auth = new ZoomAuth(new MemoryCredentials({ zoom: { clientId: 'cid' } }), fakeFetch(() => json({})).fn);
    await expect(auth.beginAuthorization('http://localhost/cb')).rejects.toBeInstanceOf(ZoomAuthError);
  });

  it('surfaces a failed code exchange', async () => {
    const auth = new ZoomAuth(store, fakeFetch(() => json({ reason: 'Invalid authorization code' }, 400)).fn, () => now);
    const state = new URL(await auth.beginAuthorization('http://localhost/cb')).searchParams.get('state')!;
    await expect(auth.completeAuthorization('bad', state)).rejects.toThrow(/Invalid authorization code/);
  });

  it('refreshes near expiry, stores the rotated refresh token, and shares one refresh across callers', async () => {
    store.data.zoom!.tokens = { accessToken: 'old', refreshToken: 'rt-old', expiresAt: now + 30_000 };
    let refreshes = 0;
    const { fn } = fakeFetch(async (_url, body) => {
      refreshes++;
      expect(body.get('grant_type')).toBe('refresh_token');
      expect(body.get('refresh_token')).toBe('rt-old');
      await new Promise(r => setTimeout(r, 5));
      return json({ access_token: 'new', refresh_token: 'rt-new', expires_in: 3600 });
    });
    const auth = new ZoomAuth(store, fn, () => now);
    const tokens = await Promise.all([auth.getAccessToken(), auth.getAccessToken(), auth.getAccessToken()]);
    expect(tokens).toEqual(['new', 'new', 'new']);
    expect(refreshes).toBe(1);
    expect(store.data.zoom?.tokens).toMatchObject({ accessToken: 'new', refreshToken: 'rt-new' });
  });

  it('does not refresh a fresh token unless forced', async () => {
    store.data.zoom!.tokens = { accessToken: 'fresh', refreshToken: 'rt', expiresAt: now + 3_600_000 };
    const { fn, calls } = fakeFetch(() => json({ access_token: 'forced', refresh_token: 'rt2', expires_in: 3600 }));
    const auth = new ZoomAuth(store, fn, () => now);
    expect(await auth.getAccessToken()).toBe('fresh');
    expect(calls).toHaveLength(0);
    expect(await auth.getAccessToken(true)).toBe('forced');
  });

  it('drops tokens and asks to reconnect when the refresh token is rejected', async () => {
    store.data.zoom!.tokens = { accessToken: 'old', refreshToken: 'revoked', expiresAt: 0 };
    const auth = new ZoomAuth(store, fakeFetch(() => json({ error: 'invalid_grant' }, 400)).fn, () => now);
    const err = await auth.getAccessToken().catch(e => e);
    expect(err).toBeInstanceOf(MeetingSourceError);
    expect(err.code).toBe('auth_required');
    expect(store.data.zoom?.tokens).toBeUndefined();
    expect(store.data.zoom?.clientSecret).toBe('csecret');
  });

  it('asks to connect when there are no tokens', async () => {
    await expect(new ZoomAuth(store, fakeFetch(() => json({})).fn).getAccessToken()).rejects.toMatchObject({ code: 'auth_required' });
  });

  it('revokes and clears tokens on disconnect, even if Zoom is unreachable', async () => {
    store.data.zoom!.tokens = { accessToken: 'a', refreshToken: 'r', expiresAt: 0 };
    store.data.zoom!.account = { name: 'X' };
    const { fn, calls } = fakeFetch(() => { throw new Error('offline'); });
    await new ZoomAuth(store, fn).disconnect();
    expect(calls[0].url).toBe(ZOOM_REVOKE_URL);
    expect(store.data.zoom).toEqual({ clientId: 'cid', clientSecret: 'csecret' });
  });
});
