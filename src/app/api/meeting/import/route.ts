import { NextResponse } from 'next/server';
import { meetingImportService } from '../../../../adapters/di';
import { getWorkspacePath } from '../../../../adapters/primary/api/utils';
import { sseResponse } from '../../../../adapters/primary/api/sse';
import { ImportInput } from '../../../../domain/services/MeetingImportService';
import { isAudioFilename } from '../../../../domain/services/transcript';

// 5 MB is far more than a multi-hour transcript; anything bigger is a wrong file.
const MAX_TRANSCRIPT_BYTES = 5 * 1024 * 1024;
// Recordings: matches next.config's middlewareClientMaxBodySize.
const MAX_RECORDING_BYTES = 500 * 1024 * 1024;

// Streams progress as SSE: `progress` events, then one `done` with the outcome.
// The import continues if the client disconnects.
//   JSON { link | transcript, filename?, title? }
//   multipart/form-data { file (a recording), title? } → transcribed first
export async function POST(req: Request) {
  try {
    let input: ImportInput;
    let title: unknown;
    if ((req.headers.get('content-type') ?? '').startsWith('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('file');
      title = form.get('title');
      if (!(file instanceof File)) return NextResponse.json({ error: 'Attach a recording file.' }, { status: 400 });
      if (!isAudioFilename(file.name)) {
        return NextResponse.json({ error: `${file.name} isn’t a recording. Upload the .m4a or .mp4 from the Zoom folder, or a .vtt/.txt transcript.` }, { status: 400 });
      }
      if (file.size > MAX_RECORDING_BYTES) return NextResponse.json({ error: 'That recording is too large (max 500 MB).' }, { status: 413 });
      input = { type: 'audio', data: Buffer.from(await file.arrayBuffer()), filename: file.name };
    } else {
      const body = await req.json();
      const { link, transcript, filename } = body;
      title = body.title;
      if (typeof transcript === 'string') {
        if (Buffer.byteLength(transcript) > MAX_TRANSCRIPT_BYTES) {
          return NextResponse.json({ error: 'That file is too large to be a meeting transcript (max 5 MB).' }, { status: 413 });
        }
        input = { type: 'transcript', text: transcript, filename: typeof filename === 'string' ? filename : undefined };
      } else if (typeof link === 'string') {
        input = { type: 'link', value: link };
      } else {
        return NextResponse.json({ error: 'Provide a Zoom link, a transcript or a recording.' }, { status: 400 });
      }
    }

    const workspacePath = getWorkspacePath();
    return sseResponse(async send => {
      const outcome = await meetingImportService.import(
        { workspacePath, input, title: typeof title === 'string' && title ? title : undefined },
        p => send('progress', p)
      );
      send('done', outcome);
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
