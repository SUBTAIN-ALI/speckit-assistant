import { zoomRedirectUriFor } from '../../../../lib/zoomRedirect';

export { ZOOM_CALLBACK_PATH } from '../../../../lib/zoomRedirect';

export function appOrigin(req: Request): string {
  // middleware.ts only lets loopback (or explicitly allowed) hosts through, so
  // the Host header is trusted here.
  const host = req.headers.get('host') ?? new URL(req.url).host;
  return `http://${host}`;
}

// The OAuth redirect URL for the origin the user is browsing from. Must match
// the redirect URL registered on the user's Zoom app exactly; the settings
// screen shows the same value via zoomRedirectUriFor(window.location.origin).
export function zoomRedirectUri(req: Request): string {
  return zoomRedirectUriFor(appOrigin(req));
}
