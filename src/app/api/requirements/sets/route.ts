import { NextResponse } from 'next/server';
import { requirementsService } from '../../../../adapters/di';
import { getWorkspacePath } from '../../../../adapters/primary/api/utils';
import { RequirementError } from '../../../../domain/services/requirementsOps';

export const dynamic = 'force-dynamic';

const errorResponse = (err: any) =>
  NextResponse.json({ error: err.message }, { status: err instanceof RequirementError ? 400 : 500 });

// GET → { sets: RequirementSetSummary[] } (newest first)
export async function GET() {
  try {
    return NextResponse.json({ sets: await requirementsService.list(getWorkspacePath()) });
  } catch (err: any) {
    return errorResponse(err);
  }
}

// POST { title } → { id, doc } — a new empty set for writing requirements by hand
export async function POST(req: Request) {
  try {
    const { title } = await req.json();
    return NextResponse.json(await requirementsService.create(getWorkspacePath(), typeof title === 'string' ? title : ''));
  } catch (err: any) {
    return errorResponse(err);
  }
}

// DELETE ?set=<id> → removes the set and its meeting files
export async function DELETE(req: Request) {
  try {
    await requirementsService.deleteSet(getWorkspacePath(), new URL(req.url).searchParams.get('set') ?? '');
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return errorResponse(err);
  }
}
