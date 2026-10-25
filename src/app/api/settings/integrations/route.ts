import { NextResponse } from 'next/server';
import { integrationsService } from '../../../../adapters/di';
import { IntegrationsUpdate } from '../../../../domain/services/IntegrationsService';

export const dynamic = 'force-dynamic';

// Never returns secrets — only which ones are set and a short hint.
export async function GET() {
  try {
    return NextResponse.json(await integrationsService.getView());
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = (await req.json()) as IntegrationsUpdate;
    return NextResponse.json(await integrationsService.update(body ?? {}));
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
