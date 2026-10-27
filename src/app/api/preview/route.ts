import { NextResponse } from 'next/server';
import { previewService } from '../../../adapters/di';
import { getWorkspacePath } from '../../../adapters/primary/api/utils';

export const dynamic = 'force-dynamic';

// Preview of the open project:
//   GET                          → { config, configError?, status }
//   POST { action: start|stop }  → the same view
//   PUT  { command, cwd?, port?, path? } → save .specify/preview.json
export async function GET() {
  try {
    return NextResponse.json(await previewService.view(getWorkspacePath()));
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { action } = await req.json();
    const ws = getWorkspacePath();
    if (action === 'start') await previewService.start(ws);
    else if (action === 'stop') await previewService.stop(ws);
    else return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    return NextResponse.json(await previewService.view(ws));
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

export async function PUT(req: Request) {
  try {
    const ws = getWorkspacePath();
    await previewService.saveConfig(ws, await req.json());
    return NextResponse.json(await previewService.view(ws));
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
