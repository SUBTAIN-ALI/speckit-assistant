import { NextResponse } from 'next/server';
import { requirementsService } from '../../../adapters/di';
import { getWorkspacePath } from '../../../adapters/primary/api/utils';
import { RequirementError } from '../../../domain/services/requirementsOps';

const errorResponse = (err: any) =>
  NextResponse.json({ error: err.message }, { status: err instanceof RequirementError ? 400 : 500 });

// GET ?set=<id> → { doc } (doc is null when the set doesn't exist)
export async function GET(req: Request) {
  try {
    const set = new URL(req.url).searchParams.get('set') ?? '';
    const doc = await requirementsService.get(getWorkspacePath(), set);
    return NextResponse.json({ doc });
  } catch (err: any) {
    return errorResponse(err);
  }
}

// POST { set, requirement, index? }          → add
// POST { set, restore: { requirement, index } } → undo a delete
export async function POST(req: Request) {
  try {
    const { set, requirement, index, restore } = await req.json();
    const ws = getWorkspacePath();
    if (restore) {
      const doc = await requirementsService.restore(ws, set, restore.requirement, Number(restore.index) || 0);
      return NextResponse.json({ doc });
    }
    const result = await requirementsService.add(ws, set, requirement ?? {}, typeof index === 'number' ? index : undefined);
    return NextResponse.json(result);
  } catch (err: any) {
    return errorResponse(err);
  }
}

// PATCH { set, id, patch } → update one requirement
// PATCH { set, order: [ids] } → reorder
export async function PATCH(req: Request) {
  try {
    const { set, id, patch, order } = await req.json();
    const ws = getWorkspacePath();
    const doc = Array.isArray(order)
      ? await requirementsService.reorder(ws, set, order)
      : await requirementsService.update(ws, set, id, patch ?? {});
    return NextResponse.json({ doc });
  } catch (err: any) {
    return errorResponse(err);
  }
}

// DELETE ?set=<id>&id=REQ-001 → { doc, removed, index } (removed/index enable undo)
export async function DELETE(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const result = await requirementsService.remove(getWorkspacePath(), params.get('set') ?? '', params.get('id') ?? '');
    return NextResponse.json(result);
  } catch (err: any) {
    return errorResponse(err);
  }
}
