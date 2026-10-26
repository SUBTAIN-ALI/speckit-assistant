import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  MeetingFetchResult,
  MeetingSourceError,
  MeetingSourcePort,
  ZoomToolDiscoveryPort,
  ZoomToolInfo,
} from '../../../domain/ports/out/MeetingSourcePort';
import { normalizeTranscript } from '../../../domain/services/transcript';
import {
  ASSETS_TOOL_NAMES,
  TRANSCRIPT_TOOL_NAMES,
  ToolCallResult,
  buildMeetingArgs,
  harvest,
  isAssetsTool,
  isTranscriptTool,
  isZoomDownloadUrl,
  pickTool,
  resultPayload,
} from './zoomToolResults';

// Zoom's official meetings MCP server (streamable HTTP, bearer token).
export const ZOOM_MCP_URL = process.env.SPECKIT_ZOOM_MCP_URL || 'https://mcp.zoom.us/mcp/meeting/streamable';

export type AccessTokenProvider = (forceRefresh?: boolean) => Promise<string>;

type Session = { client: Client; tools: ZoomToolInfo[] };

export class ZoomMcpMeetingSource implements MeetingSourcePort, ZoomToolDiscoveryPort {
  constructor(
    private getToken: AccessTokenProvider,
    private url: string = ZOOM_MCP_URL,
    private fetchImpl: typeof fetch = fetch
  ) {}

  private async open(token: string): Promise<Session> {
    const transport = new StreamableHTTPClientTransport(new URL(this.url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    const client = new Client({ name: 'speckit-assistant', version: '0.5.0' });
    await client.connect(transport);
    const { tools } = await client.listTools();
    return { client, tools: tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) };
  }

  // Runs fn against a connected session; on a 401 refreshes the token once and retries.
  private async withSession<T>(fn: (s: Session) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.getToken(attempt > 0);
      let session: Session | null = null;
      try {
        session = await this.open(token);
        return await fn(session);
      } catch (err) {
        const unauthorized = err instanceof StreamableHTTPError && err.code === 401;
        if (unauthorized && attempt === 0) continue;
        if (unauthorized) {
          throw new MeetingSourceError('auth_required', 'Zoom rejected the sign-in. Open Settings and click “Connect Zoom” again.');
        }
        if (err instanceof MeetingSourceError) throw err;
        throw new MeetingSourceError('unavailable', `Zoom MCP server error: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        await session?.client.close().catch(() => {});
      }
    }
    /* istanbul ignore next */
    throw new MeetingSourceError('auth_required', 'Zoom sign-in failed.');
  }

  async listTools(): Promise<ZoomToolInfo[]> {
    return this.withSession(async s => s.tools);
  }

  async fetchMeeting(meetingId: string, onProgress?: (message: string) => void): Promise<MeetingFetchResult> {
    return this.withSession(async ({ client, tools }) => {
      const raw: Array<{ tool: string; args: unknown; result: unknown }> = [{ tool: 'tools/list', args: {}, result: tools.map(t => t.name) }];

      const call = async (tool: ZoomToolInfo) => {
        const built = buildMeetingArgs(tool, meetingId);
        if ('error' in built) throw new MeetingSourceError('unavailable', built.error);
        onProgress?.(`Calling Zoom tool ${tool.name}…`);
        const result = (await client.callTool({ name: tool.name, arguments: built.args })) as ToolCallResult;
        raw.push({ tool: tool.name, args: built.args, result });
        return result;
      };

      const transcriptTool = pickTool(tools, TRANSCRIPT_TOOL_NAMES, isTranscriptTool);
      const assetsTool = pickTool(tools, ASSETS_TOOL_NAMES, isAssetsTool);
      if (!transcriptTool && !assetsTool) {
        throw new MeetingSourceError('unavailable',
          `The Zoom MCP server didn’t offer a transcript or meeting-assets tool. Available tools: ${tools.map(t => t.name).join(', ') || 'none'}.`);
      }

      const values: unknown[] = [];
      const texts: string[] = [];
      let transcriptError: string | undefined;
      const toCall = [...new Set([transcriptTool, assetsTool])].filter((t): t is ZoomToolInfo => !!t);
      for (const tool of toCall) {
        try {
          const result = await call(tool);
          const { text, data } = resultPayload(result);
          if (result.isError) {
            if (tool === transcriptTool) transcriptError = text;
            continue;
          }
          values.push(...data);
          if (data.length === 0 && text) texts.push(text);
        } catch (err) {
          if (tool === transcriptTool) transcriptError = err instanceof Error ? err.message : String(err);
          else if (err instanceof MeetingSourceError && err.code === 'auth_required') throw err;
        }
      }

      const h = harvest(values);
      // Plain-text tool output: treat VTT as transcript, anything else as summary/notes.
      for (const t of texts) {
        if (/^﻿?WEBVTT/.test(t.trimStart()) || /\d{2}:\d{2}[.,]\d{3}\s+-->/.test(t)) h.transcripts.push(t);
        else h.summaries.push(t);
      }

      // Some results only link to the transcript file; fetch it with the same token.
      if (h.transcripts.length === 0) {
        for (const url of h.downloadUrls.filter(isZoomDownloadUrl).slice(0, 2)) {
          onProgress?.('Downloading the transcript file from Zoom…');
          try {
            const res = await this.fetchImpl(url, { headers: { Authorization: `Bearer ${await this.getToken()}` } });
            if (res.ok) {
              const body = await res.text();
              if (body.trim()) {
                h.transcripts.push(body);
                break;
              }
            }
          } catch {
            // try the next url
          }
        }
      }

      const transcript = normalizeTranscript(h.transcripts.sort((a, b) => b.length - a.length)[0] ?? '');
      const summary = [...new Set(h.summaries)].join('\n\n').trim() || undefined;

      if (!transcript && !summary) {
        // The meeting itself came back, so it exists — it just has nothing to read
        // (typical on free plans, which only record to the computer).
        if (h.topic) {
          throw new MeetingSourceError('no_transcript',
            `Found the meeting “${h.topic}”, but it has no cloud recording or AI summary. Free Zoom plans record to your computer only — upload the recording’s audio (.m4a, in Documents/Zoom/<meeting>) under File instead.`);
        }
        if (transcriptError && /not\s*found|does\s*not\s*exist|no\s+(meeting|recording)|404/i.test(transcriptError)) {
          throw new MeetingSourceError('not_found', `Zoom couldn’t find meeting ${meetingId} in your account, or it has no cloud recording. If it was recorded to your computer, upload the recording (.m4a) under File instead.`);
        }
        throw new MeetingSourceError('no_transcript',
          `Zoom returned no transcript or summary for meeting ${meetingId}. Make sure cloud recording with audio transcript, or AI Companion meeting summary, was on — or upload the transcript file instead.${transcriptError ? ` (Zoom said: ${transcriptError.slice(0, 300)})` : ''}`);
      }

      return {
        snapshot: { source: 'zoom', meetingId, topic: h.topic, startTime: h.startTime, transcript, summary },
        raw,
      };
    });
  }
}
