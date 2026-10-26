import { NextRequest, NextResponse } from 'next/server';
import { ZOOM_CALLBACK_PATH } from './domain/models/credentials';

// The API is a local control plane (it spawns agent CLIs and reads stored API
// keys / Zoom tokens), so only requests addressed to a loopback host are served.
// Binding to 127.0.0.1 keeps the network out; the Host check additionally
// blocks DNS-rebinding attacks, and the Origin check blocks cross-site requests
// from web pages open in the user's browser.
// SPECKIT_ALLOWED_HOSTS (comma-separated hostnames) is an explicit opt-out for
// setups like dev containers.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function hostnameOf(hostHeader: string | null): string {
  if (!hostHeader) return '';
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1);
  return h.split(':')[0];
}

export function isAllowedHost(hostHeader: string | null, extra = process.env.SPECKIT_ALLOWED_HOSTS): boolean {
  const name = hostnameOf(hostHeader);
  if (LOOPBACK_HOSTS.has(name)) return true;
  const allowed = (extra ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(name);
}

// Browsers attach Origin to cross-site POST/PUT/PATCH/DELETE, including "simple"
// text/plain requests that skip the CORS preflight. Reject any state-changing
// request whose Origin isn't the app itself (CSRF from other websites).
export function isAllowedOrigin(method: string, origin: string | null, extra = process.env.SPECKIT_ALLOWED_HOSTS): boolean {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
  if (!origin) return true; // non-browser clients (CLI, tests) send no Origin
  if (origin === 'null') return false;
  try {
    return isAllowedHost(new URL(origin).host, extra);
  } catch {
    return false;
  }
}

function portOf(hostHeader: string | null): string {
  const m = /:(\d+)$/.exec(hostHeader ?? '');
  return m ? `:${m[1]}` : '';
}

// Pages get a readable explanation instead of a UI whose every API call fails.
function forbiddenHostPage(req: NextRequest): NextResponse {
  const host = req.headers.get('host') ?? '';
  const local = `http://localhost${portOf(host)}`;
  const name = hostnameOf(host).replace(/[<>&"]/g, '');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Local access only</title>
<style>body{font:14px/1.5 system-ui,sans-serif;max-width:560px;margin:15vh auto;padding:0 16px;color:#18181b}code{background:#f4f4f5;padding:2px 5px;border-radius:4px}</style></head>
<body><h1 style="font-size:18px">Spec Rabbit only accepts local connections</h1>
<p>It can run agent CLIs and holds your API keys, so it isn’t served on network addresses like <code>${name}</code>.</p>
<p>Open <a href="${local}">${local}</a> on this computer instead.</p>
<p>To allow this address anyway (e.g. a dev container), restart with <code>SPECKIT_ALLOWED_HOSTS=${name}</code>.</p></body></html>`;
  return new NextResponse(html, { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// The one route a public tunnel may reach: Zoom's OAuth redirect back to the
// app. It is safe to expose — it only completes a sign-in whose one-time state
// was created locally (see ZoomAuth.completeAuthorization), and it never
// returns data.
export function isPublicRoute(method: string, pathname: string): boolean {
  return method === 'GET' && pathname === ZOOM_CALLBACK_PATH;
}

export function middleware(req: NextRequest) {
  const isApi = req.nextUrl.pathname.startsWith('/api/');
  if (isPublicRoute(req.method, req.nextUrl.pathname)) return NextResponse.next();
  if (!isAllowedHost(req.headers.get('host'))) {
    return isApi ? NextResponse.json({ error: 'Forbidden host' }, { status: 403 }) : forbiddenHostPage(req);
  }
  if (isApi && !isAllowedOrigin(req.method, req.headers.get('origin'))) {
    return NextResponse.json({ error: 'Forbidden origin' }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = {
  // Everything except Next's static assets.
  matcher: '/((?!_next/static|_next/image|favicon.ico).*)',
};
