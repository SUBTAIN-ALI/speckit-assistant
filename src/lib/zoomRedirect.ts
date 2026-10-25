// Default redirect URL when no public callback URL is configured. Zoom rejects
// the hostname "localhost" at sign-in (error 4700), so local origins are
// rewritten to 127.0.0.1 — though the Marketplace form may refuse that too, in
// which case a public HTTPS callback URL (tunnel) is required; see
// ZoomSettings.callbackUrl. Shared by the API and the settings screen so the
// URL sent to Zoom and the URL the user registers always match.

import { ZOOM_CALLBACK_PATH } from '../domain/models/credentials';

export { ZOOM_CALLBACK_PATH };

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK.has(hostname.toLowerCase());
}

// origin: e.g. "http://localhost:3000"
export function zoomRedirectUriFor(origin: string): string {
  const url = new URL(origin);
  const base = isLoopbackHost(url.hostname) ? `http://127.0.0.1${url.port ? `:${url.port}` : ''}` : url.origin;
  return `${base}${ZOOM_CALLBACK_PATH}`;
}
