import { describe, it, expect } from 'vitest';
import { pickTool, isTranscriptTool, isAssetsTool, buildMeetingArgs, harvest, resultPayload, isZoomDownloadUrl, TRANSCRIPT_TOOL_NAMES } from './zoomToolResults';

describe('zoomToolResults', () => {
  it('prefers known tool names, then falls back to heuristics', () => {
    const tools = [{ name: 'fetch_recording_content' }, { name: 'get_recording_resource' }];
    expect(pickTool(tools, TRANSCRIPT_TOOL_NAMES, isTranscriptTool)?.name).toBe('get_recording_resource');
    expect(pickTool([{ name: 'fetch_recording_content' }], TRANSCRIPT_TOOL_NAMES, isTranscriptTool)?.name).toBe('fetch_recording_content');
    expect(pickTool([{ name: 'search_meetings' }], [], isAssetsTool)).toBeUndefined();
    expect(isAssetsTool('get_ai_summary')).toBe(true);
  });

  it('finds the meeting id argument from the schema', () => {
    expect(buildMeetingArgs({ name: 't', inputSchema: { properties: { meetingId: { type: 'string' } } } }, '123')).toEqual({ args: { meetingId: '123' } });
    expect(buildMeetingArgs({ name: 't', inputSchema: { properties: { meeting_uuid: { type: 'string' } } } }, '123')).toEqual({ args: { meeting_uuid: '123' } });
    expect(buildMeetingArgs({ name: 't', inputSchema: { properties: { id: { type: ['integer'] } } } }, '123')).toEqual({ args: { id: 123 } });
    expect(buildMeetingArgs({ name: 't', inputSchema: { properties: { query: { type: 'string' } } } }, '1')).toMatchObject({ error: expect.stringContaining('doesn\'t take a meeting ID') });
    expect(buildMeetingArgs({ name: 't', inputSchema: { properties: { meetingId: {}, from: {} }, required: ['meetingId', 'from'] } }, '1')).toMatchObject({ error: expect.stringContaining('also requires: from') });
    expect(buildMeetingArgs({ name: 't' }, '1')).toMatchObject({ error: expect.any(String) });
  });

  it('extracts text and JSON payloads', () => {
    expect(resultPayload({ content: [{ type: 'text', text: '{"a":1}' }, { type: 'text', text: 'plain' }, { type: 'image' }], structuredContent: { b: 2 } }))
      .toEqual({ text: '{"a":1}\n\nplain', data: [{ b: 2 }, { a: 1 }] });
  });

  it('harvests transcripts, summaries, topic, date and transcript download links', () => {
    const h = harvest([{
      meeting: { topic: 'Sync', start_time: '2026-10-20' },
      transcript_text: 'Sam: a long enough transcript line here',
      summary: { overview: 'Agreed', next_steps: ['Do X', 'Do Y'] },
      notes: 'Remember Z',
      recording_files: [
        { file_type: 'MP4', download_url: 'https://zoom.us/a.mp4' },
        { file_type: 'TRANSCRIPT', download_url: 'https://zoom.us/a' },
      ],
      share_url: 'https://zoom.us/rec/share/x',
      nested: ['WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nA: hi'],
    }]);
    expect(h.topic).toBe('Sync');
    expect(h.startTime).toBe('2026-10-20');
    expect(h.transcripts).toHaveLength(2);
    expect(h.summaries).toEqual(['overview: Agreed\nnext steps: - Do X\n- Do Y', 'notes: Remember Z']);
    expect(h.downloadUrls).toEqual(['https://zoom.us/a']);
  });

  it('only trusts https zoom.us hosts for downloads', () => {
    expect(isZoomDownloadUrl('https://us02web.zoom.us/rec/download/x')).toBe(true);
    expect(isZoomDownloadUrl('https://zoom.us/x')).toBe(true);
    expect(isZoomDownloadUrl('http://zoom.us/x')).toBe(false);
    expect(isZoomDownloadUrl('https://zoom.us.evil.com/x')).toBe(false);
    expect(isZoomDownloadUrl('https://evilzoom.us/x')).toBe(false);
    expect(isZoomDownloadUrl('nope')).toBe(false);
  });
});
