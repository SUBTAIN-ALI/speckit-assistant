// Normalizes meeting transcripts to "[hh:mm:ss] Speaker: text" lines. Zoom
// delivers WebVTT; uploads may be VTT or plain text (passed through as-is).

export type TranscriptLine = { start: string; speaker?: string; text: string };

const CUE_TIME_RE = /^(\d{1,2}:)?(\d{1,2}):(\d{2})(?:[.,]\d{1,3})?\s+-->\s+/;

function normalizeTime(raw: string): string {
  const parts = raw.split(':').map(p => p.split(/[.,]/)[0]);
  while (parts.length < 3) parts.unshift('0');
  return parts.map(p => p.padStart(2, '0')).join(':');
}

export function isVtt(text: string): boolean {
  return /^﻿?WEBVTT/.test(text.trimStart()) || /\d{2}:\d{2}[.,]\d{3}\s+-->\s+\d/.test(text);
}

export function parseVtt(vtt: string): TranscriptLine[] {
  const blocks = vtt.replace(/\r\n/g, '\n').split(/\n\s*\n/);
  const lines: TranscriptLine[] = [];
  for (const block of blocks) {
    const rows = block.split('\n').map(r => r.trim()).filter(Boolean);
    const timeIdx = rows.findIndex(r => CUE_TIME_RE.test(r));
    if (timeIdx === -1) continue;
    const start = normalizeTime(rows[timeIdx].split(/\s+-->/)[0]);
    const text = rows.slice(timeIdx + 1).join(' ').replace(/<[^>]+>/g, '').trim();
    if (!text) continue;
    // Zoom prefixes the speaker as "Name: text"; <v Name> voice tags are also common.
    const voice = /<v\s+([^>]+)>/.exec(rows.slice(timeIdx + 1).join(' '));
    const m = /^([^:]{1,60}):\s+([\s\S]+)$/.exec(text);
    if (voice) lines.push({ start, speaker: voice[1].trim(), text });
    else if (m) lines.push({ start, speaker: m[1].trim(), text: m[2].trim() });
    else lines.push({ start, text });
  }
  // Merge consecutive cues from the same speaker to keep the prompt compact.
  const merged: TranscriptLine[] = [];
  for (const l of lines) {
    const prev = merged[merged.length - 1];
    if (prev && prev.speaker && prev.speaker === l.speaker) prev.text = `${prev.text} ${l.text}`;
    else merged.push({ ...l });
  }
  return merged;
}

export function formatTranscript(lines: TranscriptLine[]): string {
  return lines.map(l => `[${l.start}] ${l.speaker ? `${l.speaker}: ` : ''}${l.text}`).join('\n');
}

export function normalizeTranscript(raw: string): string {
  const text = (raw ?? '').replace(/\r\n/g, '\n').trim();
  if (!text) return '';
  if (isVtt(text)) {
    const lines = parseVtt(text);
    if (lines.length > 0) return formatTranscript(lines);
  }
  return text;
}

// Splits a long transcript on line boundaries into chunks of at most maxChars.
export function chunkTranscript(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  let current = '';
  for (const line of text.split('\n')) {
    if (current && current.length + line.length + 1 > maxChars) {
      chunks.push(current);
      current = '';
    }
    // A single line longer than the limit is split hard.
    let rest = line;
    while (rest.length > maxChars) {
      chunks.push(rest.slice(0, maxChars));
      rest = rest.slice(maxChars);
    }
    current = current ? `${current}\n${rest}` : rest;
  }
  if (current) chunks.push(current);
  return chunks;
}

// Timestamped speech segments (from audio transcription) → transcript lines,
// merging consecutive segments from the same speaker.
export function formatSegments(segments: Array<{ start: number; speaker?: string; text: string }>): string {
  const lines: TranscriptLine[] = [];
  for (const s of segments) {
    const text = s.text.trim();
    if (!text) continue;
    const speaker = s.speaker ? `Speaker ${s.speaker}` : undefined;
    const prev = lines[lines.length - 1];
    if (prev && speaker && prev.speaker === speaker) prev.text = `${prev.text} ${text}`;
    else lines.push({ start: secondsToClock(s.start), speaker, text });
  }
  return formatTranscript(lines);
}

export function secondsToClock(total: number): string {
  const s = Math.max(0, Math.floor(total));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map(n => String(n).padStart(2, '0')).join(':');
}

// Audio/video files the transcription path accepts (by extension).
export const AUDIO_EXTENSIONS = ['m4a', 'mp3', 'mp4', 'mpeg', 'mpga', 'wav', 'webm', 'ogg', 'flac'];

export function isAudioFilename(name: string): boolean {
  return AUDIO_EXTENSIONS.includes(extensionOf(name));
}

// Written requirement documents, converted to text before extraction. Plain
// text (.txt, .md, .vtt, .csv) needs no conversion and takes the transcript path.
// The legacy binary Office formats are listed so they get a "save as" hint
// instead of being read as garbled text.
export const DOCUMENT_EXTENSIONS = ['pdf', 'docx', 'pptx', 'xlsx', 'odt', 'odp', 'ods', 'rtf', 'html', 'htm', 'epub', 'doc', 'ppt', 'xls'];

// Requirement documents are text-heavy; anything bigger is usually a deck or
// scan full of images, which costs parse time without adding requirements.
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

export function documentTooLarge(filename: string, bytes: number): string {
  return `${filename} is ${(bytes / 1024 / 1024).toFixed(1)} MB; documents can be up to ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB. Remove large images or split it, then upload it again.`;
}

export function isDocumentFilename(name: string): boolean {
  return DOCUMENT_EXTENSIONS.includes(extensionOf(name));
}

export function extensionOf(name: string): string {
  return name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : '';
}
