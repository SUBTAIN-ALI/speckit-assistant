import { NextResponse } from 'next/server';
import { previewService } from '../../../../adapters/di';
import { getWorkspacePath } from '../../../../adapters/primary/api/utils';
import { sseResponse } from '../../../../adapters/primary/api/sse';

// The active agent prepares the preview (or fixes a failed start), streaming SSE:
//   POST { mode: 'prepare' | 'fix', feature? } → log events, then `done` with the result.
// The run continues if the client disconnects.
export async function POST(req: Request) {
  try {
    const { mode, feature } = await req.json();
    if (mode !== 'prepare' && mode !== 'fix') return NextResponse.json({ error: 'mode must be prepare or fix' }, { status: 400 });
    const ws = getWorkspacePath();
    return sseResponse(async send => {
      const result = await previewService.runAgent(ws, mode, typeof feature === 'string' ? feature : null, text => send('log', { text }));
      send('done', result);
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
