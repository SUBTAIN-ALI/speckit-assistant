import { NextResponse } from 'next/server';
import { integrationsService, zoomAuth } from '../../../../../adapters/di';

export async function POST() {
  try {
    await zoomAuth.disconnect();
    return NextResponse.json(await integrationsService.getView());
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
