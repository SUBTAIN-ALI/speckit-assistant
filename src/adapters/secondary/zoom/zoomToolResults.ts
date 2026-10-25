import { ZoomToolInfo } from '../../../domain/ports/out/MeetingSourcePort';

// Zoom does not publish its MCP tool reference, so tool selection and result
// parsing are deliberately schema-driven rather than hardcoded to one shape:
//  - tools are picked by known names first, then by name heuristics;
//  - the meeting-id argument is found from each tool's input schema;
//  - results are walked recursively for transcript / summary / topic fields.

export const TRANSCRIPT_TOOL_NAMES = ['get_recording_resource', 'get_meeting_transcript', 'get_transcript', 'get_recording_transcript'];
export const ASSETS_TOOL_NAMES = ['get_meeting_assets', 'get_meeting_summary', 'get_summary'];

export function pickTool(tools: ZoomToolInfo[], preferred: string[], heuristic: (name: string) => boolean): ZoomToolInfo | undefined {
  for (const name of preferred) {
    const t = tools.find(x => x.name === name);
    if (t) return t;
  }
  return tools.find(t => heuristic(t.name.toLowerCase()));
}

export const isTranscriptTool = (n: string) =>
  n.includes('transcript') || (n.includes('recording') && (n.includes('resource') || n.includes('content')));
export const isAssetsTool = (n: string) => n.includes('asset') || n.includes('summary');

type Schema = { properties?: Record<string, { type?: string | string[] }>; required?: string[] };

const ID_KEYS = [/^meeting_?id$/i, /^meetingid$/i, /^meeting_?uuid$/i, /^uuid$/i, /^id$/i];

// Builds arguments for a tool that takes a meeting id, or returns an error naming
// the required arguments we can't fill.
export function buildMeetingArgs(tool: ZoomToolInfo, meetingId: string): { args: Record<string, unknown> } | { error: string } {
  const schema = (tool.inputSchema ?? {}) as Schema;
  const props = schema.properties ?? {};
  const keys = Object.keys(props);
  const idKey = ID_KEYS.map(re => keys.find(k => re.test(k))).find(Boolean);
  if (!idKey) {
    return { error: `Zoom tool "${tool.name}" doesn't take a meeting ID (arguments: ${keys.join(', ') || 'none'}).` };
  }
  const t = props[idKey]?.type;
  const wantsNumber = t === 'integer' || t === 'number' || (Array.isArray(t) && !t.includes('string') && (t.includes('integer') || t.includes('number')));
  const args: Record<string, unknown> = { [idKey]: wantsNumber ? Number(meetingId) : meetingId };
  const missing = (schema.required ?? []).filter(k => !(k in args));
  if (missing.length > 0) {
    return { error: `Zoom tool "${tool.name}" also requires: ${missing.join(', ')}.` };
  }
  return { args };
}

export type ToolCallResult = { content?: Array<{ type: string; text?: string }>; structuredContent?: unknown; isError?: boolean };

// All text content of a tool result, plus the parsed JSON when the text is JSON.
export function resultPayload(result: ToolCallResult): { text: string; data: unknown[] } {
  const texts = (result.content ?? []).filter(c => c.type === 'text' && typeof c.text === 'string').map(c => c.text!);
  const data: unknown[] = [];
  if (result.structuredContent !== undefined) data.push(result.structuredContent);
  for (const t of texts) {
    try {
      data.push(JSON.parse(t));
    } catch {
      // plain text
    }
  }
  return { text: texts.join('\n\n'), data };
}

export type Harvest = {
  transcripts: string[];
  summaries: string[];
  topic?: string;
  startTime?: string;
  downloadUrls: string[];
};

const SUMMARY_KEY = /summary|overview|next_?steps|action_?items|key_?points|notes|agenda/i;
const TRANSCRIPT_KEY = /transcript/i;
const URL_KEY = /(download|transcript|file)_?url$/i;

function flattenSummary(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v)) return v.map(flattenSummary).filter(Boolean).map(s => (s.includes('\n') ? s : `- ${s}`)).join('\n');
  if (v && typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, val]) => {
        const s = flattenSummary(val);
        return s ? `${k.replace(/_/g, ' ')}: ${s}` : '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

export function harvest(values: unknown[]): Harvest {
  const h: Harvest = { transcripts: [], summaries: [], downloadUrls: [] };
  const visit = (v: unknown, key: string, parent: Record<string, unknown> | null) => {
    if (typeof v === 'string') {
      if (/^﻿?WEBVTT/.test(v.trimStart())) h.transcripts.push(v);
      else if (TRANSCRIPT_KEY.test(key) && !/url$/i.test(key) && v.length > 20) h.transcripts.push(v);
      else if (/^(topic|title|meeting_?topic)$/i.test(key) && !h.topic) h.topic = v;
      else if (/^(start_?time|meeting_?start_?time|date)$/i.test(key) && !h.startTime) h.startTime = v;
      else if (URL_KEY.test(key) && /^https:\/\//.test(v)) {
        const fileType = String(parent?.file_type ?? parent?.recording_type ?? parent?.file_extension ?? '');
        if (/transcript|vtt/i.test(fileType) || /transcript|\.vtt/i.test(key + v)) h.downloadUrls.push(v);
      }
      return;
    }
    if (SUMMARY_KEY.test(key) && v && typeof v === 'object') {
      const s = flattenSummary(v);
      if (s) h.summaries.push(s);
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) visit(item, key, parent);
      return;
    }
    if (v && typeof v === 'object') {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (typeof val === 'string' && SUMMARY_KEY.test(k) && !TRANSCRIPT_KEY.test(k) && !/url$/i.test(k)) {
          if (val.trim()) h.summaries.push(`${k.replace(/_/g, ' ')}: ${val.trim()}`);
          continue;
        }
        visit(val, k, v as Record<string, unknown>);
      }
    }
  };
  for (const v of values) visit(v, '', null);
  return h;
}

export function isZoomDownloadUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'zoom.us' || u.hostname.endsWith('.zoom.us'));
  } catch {
    return false;
  }
}
