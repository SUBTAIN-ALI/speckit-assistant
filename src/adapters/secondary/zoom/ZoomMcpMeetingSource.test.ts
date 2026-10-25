import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as http from 'http';
import { AddressInfo } from 'net';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ZoomMcpMeetingSource } from './ZoomMcpMeetingSource';
import { MeetingSourceError } from '../../../domain/ports/out/MeetingSourcePort';

// A real MCP server over streamable HTTP standing in for Zoom's, so the client,
// transport, bearer auth and 401 retry are exercised end to end.

type ToolDef = { name: string; inputSchema: Record<string, unknown>; handler: (args: any) => any };

let tools: ToolDef[] = [];
let validTokens = new Set<string>();
let seenTokens: string[] = [];
let httpServer: http.Server;
let url: string;

const VTT = 'WEBVTT\n\n00:00:05.000 --> 00:00:08.000\nSam: We need password reset by email.\n';

function mcpServer() {
  const server = new Server({ name: 'fake-zoom', version: '1.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map(t => ({ name: t.name, description: t.name, inputSchema: t.inputSchema })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async req => {
    const tool = tools.find(t => t.name === req.params.name);
    if (!tool) return { isError: true, content: [{ type: 'text', text: 'unknown tool' }] };
    return tool.handler(req.params.arguments ?? {});
  });
  return server;
}

beforeAll(async () => {
  httpServer = http.createServer(async (req, res) => {
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    seenTokens.push(token);
    if (!validTokens.has(token)) {
      res.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { code: -32003, message: 'Access token is required' } }));
      return;
    }
    if (req.url === '/transcript.vtt') {
      res.writeHead(200, { 'Content-Type': 'text/vtt' }).end(VTT);
      return;
    }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    const server = mcpServer();
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  });
  await new Promise<void>(r => httpServer.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}/mcp`;
});

afterAll(() => new Promise<void>(r => httpServer.close(() => r())));

beforeEach(() => {
  validTokens = new Set(['good']);
  seenTokens = [];
  tools = [];
});

const source = (tokens: string[] = ['good'], fetchImpl?: typeof fetch) => {
  const queue = [...tokens];
  const calls: boolean[] = [];
  const getToken = async (force?: boolean) => { calls.push(!!force); return queue.length > 1 ? queue.shift()! : queue[0]; };
  return { src: new ZoomMcpMeetingSource(getToken, url, fetchImpl), calls };
};

const meetingIdSchema = { type: 'object', properties: { meetingId: { type: 'string' } }, required: ['meetingId'] };

describe('ZoomMcpMeetingSource (against a real MCP server)', () => {
  it('lists tools with the bearer token', async () => {
    tools = [{ name: 'get_meeting_assets', inputSchema: meetingIdSchema, handler: () => ({ content: [] }) }];
    const { src } = source();
    expect((await src.listTools()).map(t => t.name)).toEqual(['get_meeting_assets']);
    expect(seenTokens.every(t => t === 'good')).toBe(true);
  });

  it('fetches transcript and summary, parsing JSON results', async () => {
    const calls: any[] = [];
    tools = [
      { name: 'get_recording_resource', inputSchema: meetingIdSchema, handler: args => { calls.push(args); return { content: [{ type: 'text', text: JSON.stringify({ topic: 'Weekly sync', start_time: '2026-10-20T15:00:00Z', transcript: VTT }) }] }; } },
      { name: 'get_meeting_assets', inputSchema: meetingIdSchema, handler: () => ({ content: [{ type: 'text', text: JSON.stringify({ meeting_summary: { summary_overview: 'Team agreed on resets.', next_steps: ['Ship reset flow'] } }) }] }) },
      { name: 'create_meeting', inputSchema: { type: 'object', properties: {} }, handler: () => { throw new Error('must not be called'); } },
    ];
    const progress: string[] = [];
    const { src } = source();
    const { snapshot, raw } = await src.fetchMeeting('85012345678', m => progress.push(m));
    expect(calls).toEqual([{ meetingId: '85012345678' }]);
    expect(snapshot).toMatchObject({ source: 'zoom', meetingId: '85012345678', topic: 'Weekly sync', startTime: '2026-10-20T15:00:00Z' });
    expect(snapshot.transcript).toBe('[00:00:05] Sam: We need password reset by email.');
    expect(snapshot.summary).toContain('summary overview: Team agreed on resets.');
    expect(snapshot.summary).toContain('Ship reset flow');
    expect(progress).toEqual(['Calling Zoom tool get_recording_resource…', 'Calling Zoom tool get_meeting_assets…']);
    expect(JSON.stringify(raw)).toContain('get_recording_resource');
  });

  it('passes numeric meeting ids when the schema asks for a number, and accepts plain-text VTT', async () => {
    let got: unknown;
    tools = [{ name: 'get_meeting_transcript', inputSchema: { type: 'object', properties: { meeting_id: { type: 'integer' } } }, handler: args => { got = args.meeting_id; return { content: [{ type: 'text', text: VTT }] }; } }];
    const { snapshot } = (await source().src.fetchMeeting('85012345678'));
    expect(got).toBe(85012345678);
    expect(snapshot.transcript).toContain('Sam: We need password reset');
  });

  it('downloads a linked transcript file from a zoom.us URL only', async () => {
    tools = [{ name: 'get_recording_resource', inputSchema: meetingIdSchema, handler: () => ({ content: [{ type: 'text', text: JSON.stringify({ recording_files: [
      { file_type: 'TRANSCRIPT', download_url: 'https://evil.example.com/t.vtt' },
      { file_type: 'TRANSCRIPT', download_url: 'https://us02web.zoom.us/rec/download/t.vtt' },
    ] }) }] }) }];
    const fetched: string[] = [];
    const fakeFetch = (async (u: string, init: RequestInit) => {
      fetched.push(`${u} ${(init.headers as Record<string, string>).Authorization}`);
      return new Response(VTT);
    }) as unknown as typeof fetch;
    const { snapshot } = await source(['good'], fakeFetch).src.fetchMeeting('85012345678');
    expect(fetched).toEqual(['https://us02web.zoom.us/rec/download/t.vtt Bearer good']);
    expect(snapshot.transcript).toContain('password reset');
  });

  it('refreshes the token once on 401 and retries', async () => {
    tools = [{ name: 'get_recording_resource', inputSchema: meetingIdSchema, handler: () => ({ content: [{ type: 'text', text: VTT }] }) }];
    const { src, calls } = source(['expired', 'good']);
    const { snapshot } = await src.fetchMeeting('85012345678');
    expect(snapshot.transcript).toContain('Sam');
    expect(calls.slice(0, 2)).toEqual([false, true]);
  });

  it('reports auth_required when the refreshed token is also rejected', async () => {
    validTokens = new Set();
    const err = await source(['bad']).src.listTools().catch(e => e);
    expect(err).toBeInstanceOf(MeetingSourceError);
    expect(err.code).toBe('auth_required');
  });

  it('reports not_found / no_transcript / unavailable', async () => {
    tools = [{ name: 'get_recording_resource', inputSchema: meetingIdSchema, handler: () => ({ isError: true, content: [{ type: 'text', text: 'Meeting does not exist: 123' }] }) }];
    expect((await source().src.fetchMeeting('85012345678').catch(e => e)).code).toBe('not_found');

    tools = [{ name: 'get_recording_resource', inputSchema: meetingIdSchema, handler: () => ({ content: [{ type: 'text', text: JSON.stringify({ recording_files: [] }) }] }) }];
    expect((await source().src.fetchMeeting('85012345678').catch(e => e)).code).toBe('no_transcript');

    tools = [{ name: 'list_users', inputSchema: { type: 'object', properties: {} }, handler: () => ({ content: [] }) }];
    const err = await source().src.fetchMeeting('85012345678').catch(e => e);
    expect(err.code).toBe('unavailable');
    expect(err.message).toContain('list_users');
  });

  it('uses the summary when only an assets tool exists', async () => {
    tools = [{ name: 'get_meeting_assets', inputSchema: meetingIdSchema, handler: () => ({ content: [{ type: 'text', text: 'Summary: decided to add SSO.' }] }) }];
    const { snapshot } = await source().src.fetchMeeting('85012345678');
    expect(snapshot.transcript).toBe('');
    expect(snapshot.summary).toBe('Summary: decided to add SSO.');
  });
});
