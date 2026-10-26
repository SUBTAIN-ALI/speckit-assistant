import { describe, it, expect, beforeEach } from 'vitest';
import { MeetingImportService, GITIGNORE_ENTRY } from './MeetingImportService';
import { IntegrationsService } from './IntegrationsService';
import { RequirementsService } from './RequirementsService';
import { MemoryCredentials, MemoryHistory, MemoryWorkspace, ScriptedLlm } from '../../test/meetingFakes';
import { LlmError, LlmJsonResponse } from '../ports/out/LlmPort';
import { MeetingFetchResult, MeetingSourceError, MeetingSourcePort } from '../ports/out/MeetingSourcePort';
import { parseRequirements } from './requirementsMarkdown';
import { ImportProgress } from '../models/meeting';
import { AudioInput, TranscriberPort, TranscriptionError, TranscriptionResult } from '../ports/out/TranscriberPort';
import { DocumentInput, DocumentReadError, DocumentReaderPort, DocumentText } from '../ports/out/DocumentReaderPort';

const extraction = (...titles: string[]) => ({
  title: 'Checkout',
  requirements: titles.map(t => ({
    title: t, type: 'functional', priority: 'must', description: `${t} desc`, acceptanceCriteria: ['works'],
    sourceTimestamp: '00:00:05', sourceSpeaker: 'Sam', sourceQuote: 'we need it',
  })),
});

class FakeSource implements MeetingSourcePort {
  calls: string[] = [];
  constructor(private result: MeetingFetchResult | Error) {}
  async fetchMeeting(id: string, onProgress?: (m: string) => void) {
    this.calls.push(id);
    onProgress?.('calling zoom');
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

const ZOOM_RESULT: MeetingFetchResult = {
  snapshot: { source: 'zoom', meetingId: '85012345678', topic: 'Weekly sync', startTime: '2026-10-20', transcript: '[00:00:05] Sam: we need password reset', summary: 'Discussed resets.' },
  raw: [{ tool: 'tools/list', result: ['get_recording_resource'] }],
};

describe('MeetingImportService', () => {
  let ws: MemoryWorkspace;
  let history: MemoryHistory;
  let llm: ScriptedLlm;
  let source: FakeSource;
  let creds: MemoryCredentials;

  const make = () => {
    const integrations = new IntegrationsService(creds, () => llm, {});
    return new MeetingImportService(ws, new RequirementsService(ws, undefined, () => 1_000), integrations, () => source, history, () => 1_000);
  };
  const run = (input: any, title?: string) => {
    const progress: ImportProgress[] = [];
    return make().import({ workspacePath: '/ws', input, title }, p => progress.push(p)).then(o => ({ ...o, progress }));
  };
  const dir = (setId: string) => `.specify/meetings/${setId}`;

  beforeEach(() => {
    ws = new MemoryWorkspace();
    history = new MemoryHistory();
    creds = new MemoryCredentials({ llm: { provider: 'openai', keys: { openai: 'sk-test-key-1234' }, models: {} } });
    llm = new ScriptedLlm('openai', [{ json: extraction('Reset password', 'Export CSV') }]);
    source = new FakeSource(ZOOM_RESULT);
  });

  it('imports a Zoom meeting end to end', async () => {
    const out = await run({ type: 'link', value: 'https://us02web.zoom.us/j/85012345678?pwd=x' });
    expect(out.status).toBe('ok');
    expect(out.added).toBe(2);
    expect(source.calls).toEqual(['85012345678']);
    // A new set named after the meeting date + topic.
    expect(out.setId).toBe('2026-10-20-weekly-sync');

    const md = ws.files.get(`${dir(out.setId!)}/requirements.md`)!;
    const doc = parseRequirements(md);
    expect(doc.meta).toMatchObject({ source: 'zoom', meetingId: '85012345678', meetingTopic: 'Weekly sync', title: 'Checkout' });
    expect(doc.requirements.map(r => [r.id, r.title, r.status])).toEqual([['REQ-001', 'Reset password', 'draft'], ['REQ-002', 'Export CSV', 'draft']]);

    // Snapshot files for traceability
    expect(ws.files.get(`${dir(out.setId!)}/transcript.md`)).toContain('password reset');
    expect(ws.files.get(`${dir(out.setId!)}/summary.md`)).toContain('Discussed resets.');
    expect(JSON.parse(ws.files.get(`${dir(out.setId!)}/meeting.json`)!)).toMatchObject({ meetingId: '85012345678', importedAt: '1970-01-01T00:00:01.000Z' });
    expect(ws.files.get(`${dir(out.setId!)}/zoom-raw.json`)).toContain('get_recording_resource');
    expect(ws.files.get('.gitignore')).toContain(GITIGNORE_ENTRY);

    // Prompt: transcript fenced, summary included, schema passed
    expect(llm.calls[0].user).toContain('<transcript>\n[00:00:05] Sam: we need password reset\n</transcript>');
    expect(llm.calls[0].user).toContain('Discussed resets.');
    expect(llm.calls[0].schemaName).toBe('meeting_requirements');

    // Recorded as an execution with cost
    expect(history.records[0]).toMatchObject({ kind: 'meeting', feature: null, status: 'passed', exitCode: 0 });
    expect(history.records[0].cost).toMatchObject({ inputTokens: 100, outputTokens: 50, source: 'parsed' });
    expect(out.progress.map(p => p.step)).toEqual(expect.arrayContaining(['fetching', 'saving', 'extracting']));
  });

  it('imports an uploaded VTT transcript without Zoom', async () => {
    const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nAna: we need CSV export\n';
    const out = await run({ type: 'transcript', text: vtt, filename: 'm.vtt' });
    expect(out.status).toBe('ok');
    expect(source.calls).toEqual([]);
    // No meeting date: named after today (the injected clock) + the file name.
    expect(out.setId).toBe('1970-01-01-m');
    expect(ws.files.get(`${dir(out.setId!)}/transcript.md`)).toBe('[00:00:01] Ana: we need CSV export\n');
    expect(parseRequirements(ws.files.get(`${dir(out.setId!)}/requirements.md`)!).meta.source).toBe('upload');
  });

  it('creates a separate set for every import and honors a custom title', async () => {
    const a = await run({ type: 'link', value: '85012345678' });
    llm = new ScriptedLlm('openai', [{ json: extraction('Audit log') }]);
    const b = await run({ type: 'link', value: '85012345678' }, 'Checkout sync');
    llm = new ScriptedLlm('openai', [{ json: extraction('Again') }]);
    const c = await run({ type: 'link', value: '85012345678' }, 'Checkout sync');
    expect([a.setId, b.setId, c.setId]).toEqual(['2026-10-20-weekly-sync', '2026-10-20-checkout-sync', '2026-10-20-checkout-sync-2']);
    expect(b.doc!.meta.title).toBe('Checkout sync');
    // The first set is untouched.
    expect(parseRequirements(ws.files.get(`${dir(a.setId!)}/requirements.md`)!).requirements.map(r => r.title)).toEqual(['Reset password', 'Export CSV']);
  });

  it('retries once when the model returns an invalid shape', async () => {
    llm = new ScriptedLlm('openai', [{ json: { requirements: [{ title: 'x', type: 'epic' }] } }, { json: extraction('Fixed') }]);
    const out = await run({ type: 'link', value: '85012345678' });
    expect(out.status).toBe('ok');
    expect(llm.calls[1].user).toContain('Your previous answer was rejected');
    expect(out.cost?.inputTokens).toBe(200);
  });

  it('retries once on invalid JSON, then reports invalid_output and keeps the raw text', async () => {
    llm = new ScriptedLlm('openai', [new LlmError('invalid_json', 'bad', 'not json {'), new LlmError('invalid_json', 'bad', 'still not json')]);
    const out = await run({ type: 'link', value: '85012345678' });
    expect(out.status).toBe('invalid_output');
    expect(ws.files.get(`${dir('2026-10-20-weekly-sync')}/extraction.json`)).toBe('still not json');
    expect(ws.files.has(`${dir('2026-10-20-weekly-sync')}/requirements.md`)).toBe(false);
    expect(history.records[0].status).toBe('failed');
  });

  it('records the configured model and writes no empty extraction file when the LLM call fails', async () => {
    llm = new ScriptedLlm('openai', [new LlmError('auth', 'bad key')]);
    await run({ type: 'link', value: '85012345678' });
    expect(history.records[0].cost?.model).toBe('gpt-5');
    expect(ws.files.has(`${dir('2026-10-20-weekly-sync')}/extraction.json`)).toBe(false);
  });

  it.each([
    ['auth', /rejected your API key/],
    ['not_found', /model isn’t available/],
    ['rate_limit', /rate-limiting/],
    ['refusal', /declined/],
  ] as const)('maps LLM %s errors to a helpful message', async (kind, msg) => {
    llm = new ScriptedLlm('openai', [new LlmError(kind, 'declined by model')]);
    const out = await run({ type: 'link', value: '85012345678' });
    expect(out.status).toBe('llm_error');
    expect(out.message).toMatch(msg);
  });

  it.each([
    [new MeetingSourceError('auth_required', 'connect zoom'), 'auth_required'],
    [new MeetingSourceError('not_found', 'nope'), 'not_found'],
    [new MeetingSourceError('no_transcript', 'none'), 'no_transcript'],
    [new MeetingSourceError('unavailable', 'server down'), 'source_error'],
  ] as const)('maps source error %s', async (err, status) => {
    source = new FakeSource(err);
    const out = await run({ type: 'link', value: '85012345678' });
    expect(out.status).toBe(status);
    expect(llm.calls).toHaveLength(0);
    expect(history.records[0].status).toBe('failed');
  });

  it('extracts from the summary alone when there is no transcript', async () => {
    source = new FakeSource({ snapshot: { source: 'zoom', meetingId: '85012345678', transcript: '', summary: 'Decided: add SSO.' } });
    const out = await run({ type: 'link', value: '85012345678' });
    expect(out.status).toBe('ok');
    expect(llm.calls[0].user).toContain('<transcript>\nDecided: add SSO.\n</transcript>');
    expect(llm.calls[0].user).not.toContain('meeting_summary');
  });

  it('splits very long transcripts and merges the parts', async () => {
    const long = Array.from({ length: 3000 }, (_, i) => `[00:00:00] S: line ${i} ${'x'.repeat(40)}`).join('\n');
    source = new FakeSource({ snapshot: { source: 'zoom', meetingId: '85012345678', transcript: long } });
    llm = new ScriptedLlm('openai', [{ json: extraction('A', 'B') }, { json: extraction('b', 'C') }]);
    const out = await run({ type: 'link', value: '85012345678' });
    expect(llm.calls).toHaveLength(2);
    expect(out.doc!.requirements.map(r => r.title)).toEqual(['A', 'B', 'C']);
  });

  it('fails fast on bad input before any network call or run record', async () => {
    expect((await run({ type: 'link', value: 'https://zoom.us/rec/share/abc' })).status).toBe('unsupported_link');
    expect((await run({ type: 'link', value: 'hello' })).status).toBe('invalid_input');
    expect((await run({ type: 'transcript', text: '   ' })).status).toBe('invalid_input');
    creds.data = {};
    expect((await run({ type: 'link', value: '85012345678' })).status).toBe('not_configured');
    expect(source.calls).toHaveLength(0);
    expect(history.records).toHaveLength(0);
  });

  it('does not duplicate the .gitignore entry and preserves existing content', async () => {
    ws.files.set('.gitignore', 'node_modules');
    await run({ type: 'link', value: '85012345678' });
    llm = new ScriptedLlm('openai', [{ json: extraction('again') } as Partial<LlmJsonResponse>]);
    await run({ type: 'link', value: '85012345678' });
    const gi = ws.files.get('.gitignore')!;
    expect(gi.startsWith('node_modules\n')).toBe(true);
    expect(gi.split('\n').filter(l => l === GITIGNORE_ENTRY)).toHaveLength(1);
  });

  describe('recordings', () => {
    class FakeTranscriber implements TranscriberPort {
      calls: Array<{ apiKey: string; filename: string }> = [];
      constructor(private result: TranscriptionResult | Error) {}
      async transcribe(apiKey: string, audio: AudioInput, onProgress?: (m: string) => void) {
        this.calls.push({ apiKey, filename: audio.filename });
        onProgress?.('Transcribing the recording with OpenAI…');
        if (this.result instanceof Error) throw this.result;
        return this.result;
      }
    }
    const RESULT: TranscriptionResult = {
      segments: [{ start: 5, end: 8, speaker: 'A', text: 'We need password reset.' }, { start: 9, end: 10, speaker: 'B', text: 'Agreed.' }],
      durationSec: 125, model: 'gpt-4o-transcribe-diarize', costUSD: 0.0125,
    };
    const runAudio = (transcriber: FakeTranscriber) => {
      const progress: ImportProgress[] = [];
      const integrations = new IntegrationsService(creds, () => llm, {});
      const svc = new MeetingImportService(ws, new RequirementsService(ws, undefined, () => 1_000), integrations, () => source, history, () => 1_000, undefined, transcriber);
      return svc.import({ workspacePath: '/ws', input: { type: 'audio', data: Buffer.from('audio'), filename: 'audio0123.m4a' } }, p => progress.push(p))
        .then(o => ({ ...o, progress }));
    };

    it('transcribes the recording, then extracts from the transcript', async () => {
      const t = new FakeTranscriber(RESULT);
      const out = await runAudio(t);
      expect(out.status).toBe('ok');
      expect(t.calls).toEqual([{ apiKey: 'sk-test-key-1234', filename: 'audio0123.m4a' }]);
      expect(out.message).toMatch(/^Transcribed the recording \(00:02:05\) with gpt-4o-transcribe-diarize, about \$0\.01\. Added 2 requirements/);
      expect(out.setId).toBe('1970-01-01-audio0123');
      expect(ws.files.get(`${dir(out.setId!)}/transcript.md`)).toBe('[00:00:05] Speaker A: We need password reset.\n[00:00:09] Speaker B: Agreed.\n');
      expect(llm.calls[0].user).toContain('Speaker A: We need password reset.');
      expect(out.progress[0].step).toBe('transcribing');
      expect(out.cost!.costUSD).toBeGreaterThanOrEqual(0.0125);
    });

    it('needs an OpenAI key even when another provider extracts', async () => {
      creds = new MemoryCredentials({ llm: { provider: 'anthropic', keys: { anthropic: 'sk-ant-test' }, models: {} } });
      const t = new FakeTranscriber(RESULT);
      const out = await runAudio(t);
      expect(out.status).toBe('not_configured');
      expect(out.message).toContain('OpenAI');
      expect(t.calls).toHaveLength(0);
    });

    it('reports transcription failures without creating a list', async () => {
      const out = await runAudio(new FakeTranscriber(new TranscriptionError('too_large', 'This recording is 300 MB')));
      expect(out).toMatchObject({ status: 'invalid_input', message: 'This recording is 300 MB' });
      expect([...ws.files.keys()].some(k => k.startsWith('.specify/meetings/'))).toBe(false);

      const silent = await runAudio(new FakeTranscriber({ ...RESULT, segments: [] }));
      expect(silent).toMatchObject({ status: 'transcription_error', message: 'No speech was found in the recording.' });
    });
  });

  describe('documents', () => {
    class FakeReader implements DocumentReaderPort {
      calls: string[] = [];
      constructor(private result: DocumentText | Error) {}
      async read(doc: DocumentInput) {
        this.calls.push(doc.filename);
        if (this.result instanceof Error) throw this.result;
        return this.result;
      }
    }
    const PRD = '# Checkout PRD\n\n- Users must reset their password by email.';
    const runDoc = (reader: FakeReader) => {
      const progress: ImportProgress[] = [];
      const integrations = new IntegrationsService(creds, () => llm, {});
      const svc = new MeetingImportService(ws, new RequirementsService(ws, undefined, () => 1_000), integrations, () => source, history, () => 1_000, undefined, undefined, reader);
      return svc.import({ workspacePath: '/ws', input: { type: 'document', data: Buffer.from('%PDF'), filename: 'Checkout PRD.pdf' } }, p => progress.push(p))
        .then(o => ({ ...o, progress }));
    };

    it('converts the document, then extracts from it as a document, not a transcript', async () => {
      const reader = new FakeReader({ text: PRD, format: 'pdf' });
      const out = await runDoc(reader);
      expect(out.status).toBe('ok');
      expect(reader.calls).toEqual(['Checkout PRD.pdf']);
      expect(out.setId).toBe('1970-01-01-checkout-prd');
      const d = dir(out.setId!);
      expect(ws.files.get(`${d}/document.md`)).toBe(`${PRD}\n`);
      expect(ws.files.has(`${d}/transcript.md`)).toBe(false);
      expect(JSON.parse(ws.files.get(`${d}/meeting.json`)!)).toMatchObject({ source: 'upload', kind: 'document', filename: 'Checkout PRD.pdf' });
      expect(llm.calls[0].user).toContain(`<document>\n${PRD}\n</document>`);
      expect(llm.calls[0].user).toContain('a written requirements document (Checkout PRD.pdf)');
      expect(llm.calls[0].user).not.toContain('<transcript>');
      expect(out.progress[0]).toEqual({ step: 'reading', message: 'Reading Checkout PRD.pdf…' });
      expect(history.records[0]).toMatchObject({ label: 'Document Checkout PRD.pdf', command: 'document → requirements', status: 'passed' });
    });

    it('rejects documents over 5 MB before reading them', async () => {
      const reader = new FakeReader({ text: PRD, format: 'pdf' });
      const integrations = new IntegrationsService(creds, () => llm, {});
      const svc = new MeetingImportService(ws, new RequirementsService(ws, undefined, () => 1_000), integrations, () => source, history, () => 1_000, undefined, undefined, reader);
      const out = await svc.import({ workspacePath: '/ws', input: { type: 'document', data: Buffer.alloc(5 * 1024 * 1024 + 1), filename: 'deck.pptx' } });
      expect(out).toMatchObject({ status: 'invalid_input', message: expect.stringMatching(/^deck\.pptx is 5\.0 MB; documents can be up to 5 MB\./) });
      expect(reader.calls).toHaveLength(0);
      expect(llm.calls).toHaveLength(0);
    });

    it('reports unreadable documents without creating a list', async () => {
      const scanned = await runDoc(new FakeReader(new DocumentReadError('no_text', 'No text found in Checkout PRD.pdf.')));
      expect(scanned).toMatchObject({ status: 'invalid_input', message: 'No text found in Checkout PRD.pdf.' });
      const broken = await runDoc(new FakeReader(new DocumentReadError('failed', 'Couldn’t read Checkout PRD.pdf: bad xref')));
      expect(broken.status).toBe('document_error');
      expect([...ws.files.keys()].some(k => k.startsWith('.specify/meetings/'))).toBe(false);
      expect(llm.calls).toHaveLength(0);
    });
  });
});
