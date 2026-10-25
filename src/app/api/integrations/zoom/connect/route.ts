import { NextResponse } from 'next/server';
import { integrationsService, zoomAuth } from '../../../../../adapters/di';
import { ZoomAuthError } from '../../../../../adapters/secondary/zoom/ZoomAuth';
import { appOrigin, zoomRedirectUri } from '../redirect';

// Starts Zoom sign-in; the browser navigates to the returned Zoom URL. Uses the
// configured public callback URL (tunnel) when set, since Zoom refuses local ones.
export async function POST(req: Request) {
  try {
    const { zoom } = await integrationsService.getView();
    const url = await zoomAuth.beginAuthorization(zoom.callbackUrl ?? zoomRedirectUri(req), appOrigin(req));
    return NextResponse.json({ url });
  } catch (err: any) {
    const status = err instanceof ZoomAuthError && err.code === 'not_configured' ? 400 : 500;
    return NextResponse.json({ error: err.message }, { status });
  }
}
