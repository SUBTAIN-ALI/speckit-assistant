import { NextResponse } from 'next/server';
import { epsService } from '../../../adapters/di';
import { getWorkspacePath } from '../../../adapters/primary/api/utils';
import { EpsError } from '../../../domain/models/eps';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const failure = (error: unknown) => NextResponse.json({ error: error instanceof EpsError ? error.message : 'EPS operation failed. Check your connection and local project files.' },
  { status: error instanceof EpsError ? (error.kind === 'auth' ? 401 : 400) : 500 });

export async function GET() {
  try { return NextResponse.json(await epsService.view(getWorkspacePath())); }
  catch (error) { return failure(error); }
}
export async function PUT(req: Request) {
  try {
    const input = await req.json();
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new EpsError('Invalid EPS settings.');
    return NextResponse.json(await epsService.configure(getWorkspacePath(), input));
  } catch (error) { return failure(error); }
}
export async function POST(req: Request) {
  try {
    const input = await req.json();
    if (!input || typeof input !== 'object') throw new EpsError('Invalid EPS action.');
    const ws = getWorkspacePath();
    switch (input.action) {
      case 'test': await epsService.test(ws); return NextResponse.json({ ok: true });
      case 'discover': return NextResponse.json({ requirements: await epsService.discover(ws) });
      case 'sync': return NextResponse.json(await epsService.sync(ws));
      case 'import': return NextResponse.json({ setId: await epsService.importRequirement(ws, input.id) });
      case 'message': await epsService.postMessage(ws, input.id, input.type, input.body); break;
      case 'report': await epsService.report(ws, input.id, input); break;
      case 'apply-answer': await epsService.applyAnswer(ws, input.id, input.messageId); break;
      case 'use-eps-content': await epsService.resolveConflict(ws, input.id); break;
      case 'resolve-write': await epsService.resolveWrite(ws, input.writeId, input.resolution); break;
      default: throw new EpsError('Unknown EPS action.');
    }
    return NextResponse.json(await epsService.view(ws));
  } catch (error) { return failure(error); }
}
