import { NextResponse } from 'next/server';
import * as os from 'os';
import { listFolders, resolveWorkspaceInput } from '../../../../adapters/secondary/fs/workspaceConfig';

// GET ?path=<folder> → its subfolders, for the project picker (defaults to the home folder).
export async function GET(req: Request) {
  const requested = new URL(req.url).searchParams.get('path') || os.homedir();
  const r = resolveWorkspaceInput(requested);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  try {
    return NextResponse.json(listFolders(r.path));
  } catch (err: any) {
    const denied = err?.code === 'EACCES' || err?.code === 'EPERM';
    return NextResponse.json(
      { error: denied ? `macOS doesn’t allow reading ${r.path}.` : err.message },
      { status: denied ? 403 : 500 }
    );
  }
}
