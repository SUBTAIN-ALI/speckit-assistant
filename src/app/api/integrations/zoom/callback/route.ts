import { NextResponse } from 'next/server';
import { zoomAuth } from '../../../../../adapters/di';
import { appOrigin } from '../redirect';
import { isAllowedHost } from '../../../../../middleware';

export const dynamic = 'force-dynamic';

// Zoom redirects here (on 127.0.0.1, see lib/zoomRedirect.ts) after sign-in.
// Bounces back to the origin the user started from — the Requirements section,
// with the outcome in the query string.
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  // Recorded from our own (middleware-checked) Host header when sign-in began.
  // This route is also reachable through a public tunnel host, so never build
  // the return address from an untrusted Host header.
  const local = isAllowedHost(req.headers.get('host')) ? appOrigin(req) : undefined;
  const origin = (await zoomAuth.pendingReturnOrigin().catch(() => undefined)) ?? local;
  if (!origin) {
    return new NextResponse('Zoom sign-in finished. Return to Speckit Assistant on this computer.', { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  const back = (q: Record<string, string>) =>
    NextResponse.redirect(`${origin}/?${new URLSearchParams({ section: 'requirements', ...q })}`);

  const error = params.get('error');
  if (error) return back({ zoom: 'error', message: params.get('error_description') || error });

  const code = params.get('code');
  const state = params.get('state');
  if (!code || !state) return back({ zoom: 'error', message: 'Zoom didn’t return a sign-in code.' });

  try {
    await zoomAuth.completeAuthorization(code, state);
    return back({ zoom: 'connected' });
  } catch (err: any) {
    return back({ zoom: 'error', message: err.message });
  }
}
