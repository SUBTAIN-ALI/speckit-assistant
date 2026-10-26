import { NextResponse } from 'next/server';
import { getWorkspacePath } from '../../../adapters/primary/api/utils';
import {
  describeWorkspace,
  forgetWorkspace,
  listWorkspaces,
  resolveWorkspaceInput,
  saveCurrentWorkspace,
} from '../../../adapters/secondary/fs/workspaceConfig';

// The project (workspace) the app works on — meetings, specs, the board and the
// code the agents change all live in it.
//   GET                      → { current, recent }
//   POST { path }            → switch to that folder
//   DELETE { path }          → remove it from the recent list
export async function GET() {
  const current = getWorkspacePath();
  const all = listWorkspaces(current);
  return NextResponse.json({ current: all[0], recent: all.slice(1) });
}

export async function POST(req: Request) {
  try {
    const { path: input } = await req.json();
    const r = resolveWorkspaceInput(typeof input === 'string' ? input : '');
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    saveCurrentWorkspace(r.path);
    // The CLI pins the launch folder in WORKSPACE_PATH, which getWorkspacePath()
    // reads first; update it so every route of this server follows the switch.
    process.env.WORKSPACE_PATH = r.path;
    return NextResponse.json({ current: describeWorkspace(r.path) });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { path: target } = await req.json();
    if (typeof target !== 'string') return NextResponse.json({ error: 'Missing path' }, { status: 400 });
    if (target === getWorkspacePath()) return NextResponse.json({ error: 'That project is open; switch to another one first.' }, { status: 400 });
    forgetWorkspace(target);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
