import { describe, it, expect } from 'vitest';
import OpenAI from 'openai';
import { DIARIZE_MODEL, FALLBACK_MODEL, MAX_UPLOAD_BYTES, OpenAiTranscriber } from './OpenAiTranscriber';
import { TranscriptionError } from '../../../domain/ports/out/TranscriberPort';

type Call = { model: string; response_format: string; chunking_strategy?: unknown; name: string };

// A stand-in for the OpenAI client's audio.transcriptions.create.
function fakeClient(respond: (call: Call) => unknown) {
  const calls: Call[] = [];
  const client = {
    audio: {
      transcriptions: {
        create: async (params: any) => {
          const call = { model: params.model, response_format: params.response_format, chunking_strategy: params.chunking_strategy, name: params.file.name };
          calls.push(call);
          const r = respond(call);
          if (r instanceof Error) throw r;
          return r;
        },
      },
    },
  } as unknown as OpenAI;
  return { client, calls };
}

const audio = (bytes = 1000, filename = 'audio.m4a') => ({ filename, data: Buffer.alloc(bytes, 1) });
const diarized = (duration: number, ...segments: Array<[number, number, string, string]>) => ({
  duration, text: '', task: 'transcribe',
  segments: segments.map(([start, end, speaker, text]) => ({ start, end, speaker, text, id: 'x', type: 'transcript.text.segment' })),
});
const apiError = (status: number, message: string) => OpenAI.APIError.generate(status, { error: { message } }, message, new Headers());

describe('OpenAiTranscriber', () => {
  it('transcribes with speaker separation and estimates the cost', async () => {
    const { client, calls } = fakeClient(() => diarized(600, [0, 4, 'A', 'We need promo codes.'], [5, 9, 'B', 'Agreed.']));
    const progress: string[] = [];
    const r = await new OpenAiTranscriber(() => client).transcribe('sk-test', audio(), m => progress.push(m));
    expect(calls).toEqual([{ model: DIARIZE_MODEL, response_format: 'diarized_json', chunking_strategy: 'auto', name: 'audio.m4a' }]);
    expect(r.segments).toEqual([{ start: 0, end: 4, speaker: 'A', text: 'We need promo codes.' }, { start: 5, end: 9, speaker: 'B', text: 'Agreed.' }]);
    expect(r).toMatchObject({ model: DIARIZE_MODEL, durationSec: 600, costUSD: 0.06 });
    expect(progress).toEqual([]); // the caller reports the single-file case
  });

  it('falls back to whisper-1 when the diarization model is unavailable', async () => {
    const { client, calls } = fakeClient(c => c.model === DIARIZE_MODEL
      ? apiError(404, 'The model `gpt-4o-transcribe-diarize` does not exist')
      : { duration: 3, text: 'Hi.', language: 'en', segments: [{ id: 0, start: 0, end: 3, text: 'Hi.' }] });
    const r = await new OpenAiTranscriber(() => client).transcribe('sk-test', audio());
    expect(calls.map(c => [c.model, c.response_format])).toEqual([[DIARIZE_MODEL, 'diarized_json'], [FALLBACK_MODEL, 'verbose_json']]);
    expect(r.model).toBe(FALLBACK_MODEL);
    expect(r.segments).toEqual([{ start: 0, end: 3, text: 'Hi.' }]);
  });

  it('explains the Zoom .conf file and other unsupported files', async () => {
    const t = new OpenAiTranscriber(() => fakeClient(() => ({})).client);
    const conf = await t.transcribe('k', audio(10, 'recording.conf')).catch(e => e);
    expect(conf).toBeInstanceOf(TranscriptionError);
    expect(conf.code).toBe('unsupported');
    expect(conf.message).toContain('.m4a');
    expect((await t.transcribe('k', audio(10, 'notes.pdf')).catch(e => e)).code).toBe('unsupported');
    expect((await t.transcribe('k', audio(0)).catch(e => e)).code).toBe('unsupported');
  });

  it('refuses files over 25 MB without ffmpeg', async () => {
    const t = new OpenAiTranscriber(() => fakeClient(() => ({})).client, async () => false);
    const err = await t.transcribe('k', audio(MAX_UPLOAD_BYTES + 1, 'video.mp4')).catch(e => e);
    expect(err.code).toBe('too_large');
    expect(err.message).toContain('brew install ffmpeg');
  });

  it('splits large files with ffmpeg and offsets the timestamps', async () => {
    let n = 0;
    const { client, calls } = fakeClient(() => (n++ === 0
      ? diarized(1200, [10, 12, 'A', 'First part.'])
      : diarized(90, [5, 7, 'A', 'Second part.'])));
    const t = new OpenAiTranscriber(() => client, async () => true, async () => [Buffer.from('p0'), Buffer.from('p1')]);
    const progress: string[] = [];
    const r = await t.transcribe('k', audio(MAX_UPLOAD_BYTES + 1, 'video.mp4'), m => progress.push(m));
    expect(calls.map(c => c.name)).toEqual(['part0.mp3', 'part1.mp3']);
    expect(r.segments.map(s => [s.start, s.text])).toEqual([[10, 'First part.'], [1205, 'Second part.']]);
    expect(r.durationSec).toBe(1290);
    expect(progress).toContain('Transcribing part 2 of 2…');
  });

  it('maps a rejected key to an auth error', async () => {
    const { client } = fakeClient(() => apiError(401, 'Incorrect API key provided'));
    const err = await new OpenAiTranscriber(() => client).transcribe('bad', audio()).catch(e => e);
    expect(err).toBeInstanceOf(TranscriptionError);
    expect(err.code).toBe('auth');
  });
});
