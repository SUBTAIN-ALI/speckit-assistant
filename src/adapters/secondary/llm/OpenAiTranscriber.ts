import OpenAI, { toFile } from 'openai';
import type { TranscriptionDiarized } from 'openai/resources/audio/transcriptions';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  AudioInput,
  TranscriberPort,
  TranscriptionError,
  TranscriptionResult,
  TranscriptSegment,
} from '../../../domain/ports/out/TranscriberPort';
import { AUDIO_EXTENSIONS } from '../../../domain/services/transcript';

// OpenAI speech-to-text with speaker separation (gpt-4o-transcribe-diarize),
// falling back to whisper-1 (timestamps, no speakers) if that model isn't
// available to the key. OpenAI accepts up to 25 MB per file; larger recordings
// are compressed to mono 32 kbps MP3 and split into 20-minute parts with
// ffmpeg when it's installed.

export const DIARIZE_MODEL = 'gpt-4o-transcribe-diarize';
export const FALLBACK_MODEL = 'whisper-1';
export const MAX_UPLOAD_BYTES = 24 * 1024 * 1024; // a little under OpenAI's 25 MB
const PART_SECONDS = 20 * 60;
const USD_PER_MINUTE = 0.006; // estimate for both models

export type FfmpegSplitter = (audio: AudioInput, partSeconds: number) => Promise<Buffer[]>;

const run = (cmd: string, args: string[]) =>
  new Promise<void>((resolve, reject) => execFile(cmd, args, { maxBuffer: 1024 * 1024 }, err => (err ? reject(err) : resolve())));

export async function ffmpegAvailable(): Promise<boolean> {
  try {
    await run('ffmpeg', ['-version']);
    return true;
  } catch {
    return false;
  }
}

// Extract the audio track, downmix and compress, and cut into fixed-length parts.
export const ffmpegSplit: FfmpegSplitter = async (audio, partSeconds) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'speckit-audio-'));
  try {
    const input = path.join(dir, `input${path.extname(audio.filename) || '.m4a'}`);
    fs.writeFileSync(input, audio.data);
    await run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-i', input,
      '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k',
      '-f', 'segment', '-segment_time', String(partSeconds), '-reset_timestamps', '1',
      path.join(dir, 'part%03d.mp3'),
    ]);
    return fs.readdirSync(dir).filter(f => /^part\d+\.mp3$/.test(f)).sort().map(f => fs.readFileSync(path.join(dir, f)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

export class OpenAiTranscriber implements TranscriberPort {
  constructor(
    private makeClient: (apiKey: string) => OpenAI = apiKey => new OpenAI({ apiKey }),
    private hasFfmpeg: () => Promise<boolean> = ffmpegAvailable,
    private split: FfmpegSplitter = ffmpegSplit
  ) {}

  async transcribe(apiKey: string, audio: AudioInput, onProgress?: (message: string) => void): Promise<TranscriptionResult> {
    const ext = (audio.filename.split('.').pop() ?? '').toLowerCase();
    if (!AUDIO_EXTENSIONS.includes(ext)) {
      throw new TranscriptionError('unsupported', ext === 'conf'
        ? 'The .conf file is Zoom’s conversion settings, not a recording. Upload the .m4a (audio) or .mp4 (video) file from the same folder.'
        : `.${ext} isn’t a supported recording. Use .m4a, .mp3, .mp4, .wav, .webm, .ogg or .flac.`);
    }
    if (audio.data.length === 0) throw new TranscriptionError('unsupported', 'The recording file is empty.');

    const client = this.makeClient(apiKey);
    let parts: AudioInput[] = [audio];
    if (audio.data.length > MAX_UPLOAD_BYTES) {
      if (!(await this.hasFfmpeg())) {
        const mb = Math.round(audio.data.length / 1024 / 1024);
        throw new TranscriptionError('too_large',
          `This recording is ${mb} MB; OpenAI accepts up to 25 MB per file. Use the audio-only .m4a from the Zoom folder (about 0.5 MB per minute), or install ffmpeg (brew install ffmpeg) so long recordings can be split automatically.`);
      }
      onProgress?.('Compressing and splitting the recording with ffmpeg…');
      parts = (await this.split(audio, PART_SECONDS)).map((data, i) => ({ filename: `part${i}.mp3`, data }));
    }

    const segments: TranscriptSegment[] = [];
    let model = DIARIZE_MODEL;
    let duration = 0;
    for (let i = 0; i < parts.length; i++) {
      if (parts.length > 1) onProgress?.(`Transcribing part ${i + 1} of ${parts.length}…`);
      const offset = i * PART_SECONDS;
      const result = await this.transcribePart(client, parts[i], model).catch(async err => {
        // The diarization model may not be enabled for every key: fall back once.
        if (model === DIARIZE_MODEL && err instanceof OpenAI.APIError && (err.status === 404 || err.status === 400) && /model/i.test(err.message)) {
          model = FALLBACK_MODEL;
          onProgress?.('Speaker separation isn’t available for this key; transcribing without speaker labels…');
          return this.transcribePart(client, parts[i], model);
        }
        throw err;
      }).catch(err => { throw toError(err); });
      for (const s of result.segments) segments.push({ ...s, start: s.start + offset, end: s.end + offset });
      // Each part except the last is exactly PART_SECONDS long.
      duration = parts.length > 1 && i < parts.length - 1 ? offset + PART_SECONDS : offset + result.duration;
    }
    return {
      segments,
      durationSec: duration,
      model,
      costUSD: Math.round((duration / 60) * USD_PER_MINUTE * 10000) / 10000,
    };
  }

  private async transcribePart(client: OpenAI, part: AudioInput, model: string): Promise<{ segments: TranscriptSegment[]; duration: number }> {
    const file = await toFile(part.data, part.filename);
    if (model === DIARIZE_MODEL) {
      // The SDK's overloads don't narrow on diarized_json; the response is TranscriptionDiarized.
      const r = (await client.audio.transcriptions.create({ file, model, response_format: 'diarized_json', chunking_strategy: 'auto' })) as unknown as TranscriptionDiarized;
      return {
        duration: r.duration ?? 0,
        segments: (r.segments ?? []).map(s => ({ start: s.start, end: s.end, speaker: s.speaker, text: s.text })),
      };
    }
    const r = await client.audio.transcriptions.create({ file, model, response_format: 'verbose_json', timestamp_granularities: ['segment'] });
    return {
      duration: r.duration ?? 0,
      segments: (r.segments ?? []).map(s => ({ start: s.start, end: s.end, text: s.text })),
    };
  }
}

function toError(err: unknown): TranscriptionError {
  if (err instanceof TranscriptionError) return err;
  if (err instanceof OpenAI.AuthenticationError) return new TranscriptionError('auth', 'OpenAI rejected the API key. Check it in Settings.');
  if (err instanceof OpenAI.APIError) return new TranscriptionError('failed', `OpenAI transcription failed: ${err.message}`);
  return new TranscriptionError('failed', err instanceof Error ? err.message : String(err));
}
