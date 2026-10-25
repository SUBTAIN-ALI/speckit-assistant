import { NextResponse } from 'next/server';
import { meetingImportService } from '../../../../adapters/di';
import { getWorkspacePath } from '../../../../adapters/primary/api/utils';
import { ImportInput } from '../../../../domain/services/MeetingImportService';

// 5 MB is far more than a multi-hour transcript; anything bigger is a wrong file.
const MAX_TRANSCRIPT_BYTES = 5 * 1024 * 1024;

// Streams progress as SSE: `progress` events, then one `done` with the outcome.
export async function POST(req: Request) {
  try {
    const { link, transcript, filename, title } = await req.json();

    let input: ImportInput;
    if (typeof transcript === 'string') {
      if (Buffer.byteLength(transcript) > MAX_TRANSCRIPT_BYTES) {
        return NextResponse.json({ error: 'That file is too large to be a meeting transcript (max 5 MB).' }, { status: 413 });
      }
      input = { type: 'transcript', text: transcript, filename: typeof filename === 'string' ? filename : undefined };
    } else if (typeof link === 'string') {
      input = { type: 'link', value: link };
    } else {
      return NextResponse.json({ error: 'Provide a Zoom link or a transcript.' }, { status: 400 });
    }

    const workspacePath = getWorkspacePath();
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: unknown) =>
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        try {
          const outcome = await meetingImportService.import(
            { workspacePath, input, title: typeof title === 'string' ? title : undefined },
            p => send('progress', p)
          );
          send('done', outcome);
        } catch (err: any) {
          send('error', { message: err.message });
        }
        controller.close();
      },
    });

    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
