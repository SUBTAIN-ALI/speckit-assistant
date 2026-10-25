import * as crypto from 'crypto';
import { CredentialStorePort } from '../../../domain/ports/out/CredentialStorePort';
import { ZoomSettings, ZoomTokens } from '../../../domain/models/credentials';
import { MeetingSourceError } from '../../../domain/ports/out/MeetingSourcePort';

// User-level OAuth against the user's own Zoom app (authorization code + PKCE).
// Zoom's authorization server only accepts client_secret_basic, so the token
// endpoint is called with the app's client id/secret. Zoom rotates refresh
// tokens: every refresh returns a new one that must replace the old.

export const ZOOM_AUTHORIZE_URL = 'https://zoom.us/oauth/authorize';
export const ZOOM_TOKEN_URL = 'https://zoom.us/oauth/token';
export const ZOOM_REVOKE_URL = 'https://zoom.us/oauth/revoke';
export const ZOOM_USER_URL = 'https://api.zoom.us/v2/users/me';

// Read-only scopes the meeting MCP server needs for transcripts and summaries.
// Scopes are configured on the Zoom app itself; this list is shown in settings.
export const ZOOM_REQUIRED_SCOPES = [
  'meeting:read:search',
  'meeting:read:assets',
  'cloud_recording:read:list_user_recordings',
  'cloud_recording:read:content',
];

const REFRESH_MARGIN_MS = 60_000;
const PENDING_AUTH_TTL_MS = 10 * 60_000;

type Fetch = typeof fetch;

export class ZoomAuthError extends Error {
  constructor(public code: 'not_configured' | 'invalid_state' | 'exchange_failed' | 'auth_required', message: string) {
    super(message);
  }
}

const base64url = (buf: Buffer) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export class ZoomAuth {
  private refreshing: Promise<string> | null = null;

  constructor(
    private store: CredentialStorePort,
    private fetchImpl: Fetch = fetch,
    private now: () => number = Date.now
  ) {}

  private async zoom(): Promise<ZoomSettings> {
    return (await this.store.load()).zoom ?? {};
  }

  private async saveZoom(update: (z: ZoomSettings) => ZoomSettings): Promise<void> {
    const creds = await this.store.load();
    await this.store.save({ ...creds, zoom: update(creds.zoom ?? {}) });
  }

  private basicAuth(z: ZoomSettings): string {
    if (!z.clientId || !z.clientSecret) {
      throw new ZoomAuthError('not_configured', 'Add your Zoom app’s client ID and client secret in Settings first.');
    }
    return 'Basic ' + Buffer.from(`${z.clientId}:${z.clientSecret}`).toString('base64');
  }

  // Starts a sign-in: stores PKCE verifier + state, returns the Zoom URL to open.
  async beginAuthorization(redirectUri: string, returnOrigin?: string): Promise<string> {
    const z = await this.zoom();
    this.basicAuth(z); // fail fast if not configured
    const { verifier, challenge } = createPkcePair();
    const state = base64url(crypto.randomBytes(16));
    await this.saveZoom(cur => ({ ...cur, pendingAuth: { state, verifier, redirectUri, createdAt: this.now(), ...(returnOrigin ? { returnOrigin } : {}) } }));

    const url = new URL(ZOOM_AUTHORIZE_URL);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', z.clientId!);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  // Origin the in-flight sign-in started from (to return the user there).
  async pendingReturnOrigin(): Promise<string | undefined> {
    return (await this.zoom()).pendingAuth?.returnOrigin;
  }

  // Handles the redirect back from Zoom: checks state, exchanges the code.
  async completeAuthorization(code: string, state: string): Promise<void> {
    const z = await this.zoom();
    const pending = z.pendingAuth;
    const expected = pending?.state ?? '';
    const stateOk = !!pending && expected.length === state.length &&
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(state));
    if (!pending || !stateOk || this.now() - pending.createdAt > PENDING_AUTH_TTL_MS) {
      throw new ZoomAuthError('invalid_state', 'This sign-in link expired or didn’t come from this app. Start “Connect Zoom” again.');
    }

    const tokens = await this.requestTokens(z, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: pending.redirectUri,
      code_verifier: pending.verifier,
    });
    const account = await this.fetchAccount(tokens.accessToken);
    await this.saveZoom(cur => {
      const { pendingAuth: _done, ...rest } = cur;
      return { ...rest, tokens, ...(account ? { account } : {}) };
    });
  }

  // A valid access token, refreshing it first if it is about to expire. Concurrent
  // callers share one refresh so a rotated refresh token is never used twice.
  async getAccessToken(forceRefresh = false): Promise<string> {
    const z = await this.zoom();
    if (!z.tokens) throw new MeetingSourceError('auth_required', 'Zoom isn’t connected. Open Settings and click “Connect Zoom”.');
    if (!forceRefresh && z.tokens.expiresAt - REFRESH_MARGIN_MS > this.now()) return z.tokens.accessToken;
    if (!this.refreshing) {
      this.refreshing = this.refresh(z).finally(() => { this.refreshing = null; });
    }
    return this.refreshing;
  }

  private async refresh(z: ZoomSettings): Promise<string> {
    try {
      const tokens = await this.requestTokens(z, { grant_type: 'refresh_token', refresh_token: z.tokens!.refreshToken });
      await this.saveZoom(cur => ({ ...cur, tokens }));
      return tokens.accessToken;
    } catch (err) {
      if (err instanceof ZoomAuthError && err.code === 'exchange_failed') {
        // Refresh token revoked or expired: drop it so the UI shows "not connected".
        await this.saveZoom(cur => { const { tokens: _t, ...rest } = cur; return rest; });
        throw new MeetingSourceError('auth_required', 'Your Zoom sign-in expired. Open Settings and click “Connect Zoom” again.');
      }
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    const z = await this.zoom();
    if (z.tokens && z.clientId && z.clientSecret) {
      // Best effort: the local tokens are removed whether or not Zoom answers.
      try {
        await this.fetchImpl(ZOOM_REVOKE_URL, {
          method: 'POST',
          headers: { Authorization: this.basicAuth(z), 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: z.tokens.refreshToken }).toString(),
        });
      } catch {
        // ignore
      }
    }
    await this.saveZoom(cur => { const { tokens: _t, account: _a, pendingAuth: _p, ...rest } = cur; return rest; });
  }

  private async requestTokens(z: ZoomSettings, params: Record<string, string>): Promise<ZoomTokens> {
    let res: Response;
    try {
      res = await this.fetchImpl(ZOOM_TOKEN_URL, {
        method: 'POST',
        headers: { Authorization: this.basicAuth(z), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params).toString(),
      });
    } catch (err) {
      throw new Error(`Could not reach Zoom: ${err instanceof Error ? err.message : String(err)}`);
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || typeof body.access_token !== 'string') {
      const reason = typeof body.reason === 'string' ? body.reason : typeof body.error === 'string' ? body.error : `HTTP ${res.status}`;
      throw new ZoomAuthError('exchange_failed', `Zoom rejected the sign-in: ${reason}`);
    }
    const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : 3600;
    return {
      accessToken: body.access_token,
      refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : z.tokens?.refreshToken ?? '',
      expiresAt: this.now() + expiresIn * 1000,
      scope: typeof body.scope === 'string' ? body.scope : undefined,
    };
  }

  // Display name/email for the settings badge. Needs a user:read scope the app
  // may not have, so failure is fine.
  private async fetchAccount(accessToken: string): Promise<{ name?: string; email?: string } | undefined> {
    try {
      const res = await this.fetchImpl(ZOOM_USER_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) return undefined;
      const u = (await res.json()) as Record<string, unknown>;
      const name = [u.first_name, u.last_name].filter(v => typeof v === 'string' && v).join(' ') || undefined;
      const email = typeof u.email === 'string' ? u.email : undefined;
      return name || email ? { name, email } : undefined;
    } catch {
      return undefined;
    }
  }
}
