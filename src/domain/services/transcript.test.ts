import { describe, it, expect } from 'vitest';
import { parseVtt, normalizeTranscript, chunkTranscript, isVtt, formatTranscript, formatSegments, secondsToClock, isAudioFilename } from './transcript';

const ZOOM_VTT = `WEBVTT

1
00:00:01.120 --> 00:00:04.500
Sarah Lee: We keep getting tickets about locked accounts.

2
00:00:04.600 --> 00:00:06.000
Sarah Lee: Users forget passwords.

3
00:01:10.000 --> 00:01:12.000
Omar: Reset links should expire.

4
01:02:03.000 --> 01:02:05.000
<v Priya>Agreed, <b>thirty</b> minutes.
`;

describe('transcript', () => {
  it('detects VTT', () => {
    expect(isVtt(ZOOM_VTT)).toBe(true);
    expect(isVtt('﻿WEBVTT\n\n')).toBe(true);
    expect(isVtt('Sarah: hello')).toBe(false);
  });

  it('parses Zoom VTT, merging consecutive cues from the same speaker', () => {
    expect(parseVtt(ZOOM_VTT)).toEqual([
      { start: '00:00:01', speaker: 'Sarah Lee', text: 'We keep getting tickets about locked accounts. Users forget passwords.' },
      { start: '00:01:10', speaker: 'Omar', text: 'Reset links should expire.' },
      { start: '01:02:03', speaker: 'Priya', text: 'Agreed, thirty minutes.' },
    ]);
  });

  it('handles mm:ss timestamps, CRLF and cues without speakers', () => {
    const vtt = 'WEBVTT\r\n\r\n00:05.000 --> 00:07.000\r\nno speaker here\r\n';
    expect(parseVtt(vtt)).toEqual([{ start: '00:00:05', text: 'no speaker here' }]);
  });

  it('normalizes VTT to timestamped lines and passes plain text through', () => {
    expect(normalizeTranscript(ZOOM_VTT).split('\n')[1]).toBe('[00:01:10] Omar: Reset links should expire.');
    expect(normalizeTranscript('  Sarah: hi\r\nOmar: hey  ')).toBe('Sarah: hi\nOmar: hey');
    expect(normalizeTranscript('')).toBe('');
    expect(formatTranscript([{ start: '00:00:01', text: 'x' }])).toBe('[00:00:01] x');
  });

  it('chunks on line boundaries without losing text', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `[00:00:${String(i).padStart(2, '0')}] Speaker: line ${i}`);
    const text = lines.join('\n');
    const chunks = chunkTranscript(text, 200);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every(c => c.length <= 200)).toBe(true);
    expect(chunks.join('\n')).toBe(text);
    expect(chunkTranscript('short', 200)).toEqual(['short']);
  });

  it('hard-splits a single line longer than the limit', () => {
    const chunks = chunkTranscript('x'.repeat(450), 200);
    expect(chunks.map(c => c.length)).toEqual([200, 200, 50]);
  });
});

describe('formatSegments', () => {
  it('labels speakers, merges consecutive segments and formats times', () => {
    expect(formatSegments([
      { start: 1.4, speaker: 'A', text: ' We need promo codes. ' },
      { start: 4, speaker: 'A', text: 'At checkout.' },
      { start: 3725, speaker: 'B', text: 'Agreed.' },
      { start: 3730, speaker: 'B', text: '   ' },
    ])).toBe('[00:00:01] Speaker A: We need promo codes. At checkout.\n[01:02:05] Speaker B: Agreed.');
  });

  it('keeps unlabelled segments (whisper) as separate lines', () => {
    expect(formatSegments([{ start: 0, text: 'One.' }, { start: 2, text: 'Two.' }])).toBe('[00:00:00] One.\n[00:00:02] Two.');
  });

  it('clamps and floors clock times', () => {
    expect(secondsToClock(-3)).toBe('00:00:00');
    expect(secondsToClock(59.9)).toBe('00:00:59');
  });

  it('recognises recordings by extension', () => {
    expect(isAudioFilename('audio1234.M4A')).toBe(true);
    expect(isAudioFilename('video.mp4')).toBe(true);
    expect(isAudioFilename('recording.conf')).toBe(false);
    expect(isAudioFilename('meeting.vtt')).toBe(false);
  });
});
