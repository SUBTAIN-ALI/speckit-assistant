// Speech-to-text for meeting recordings (e.g. a Zoom local recording's .m4a on
// a free plan, which has no cloud transcript).

export type AudioInput = { filename: string; data: Buffer };

export type TranscriptSegment = {
  start: number; // seconds
  end: number;
  speaker?: string; // "A", "B"… when the model separates speakers
  text: string;
};

export type TranscriptionResult = {
  segments: TranscriptSegment[];
  durationSec?: number;
  model: string;
  costUSD?: number; // estimate from duration
};

export class TranscriptionError extends Error {
  constructor(public code: 'unsupported' | 'too_large' | 'auth' | 'failed', message: string) {
    super(message);
  }
}

export interface TranscriberPort {
  transcribe(apiKey: string, audio: AudioInput, onProgress?: (message: string) => void): Promise<TranscriptionResult>;
}
