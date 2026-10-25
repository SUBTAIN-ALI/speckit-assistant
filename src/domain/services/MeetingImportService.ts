import { ImportProgress, ImportStatus, MeetingSnapshot } from '../models/meeting';
import { MEETINGS_DIR, RequirementsDoc, setDir } from '../models/requirements';
import { CostMetadata } from '../models/types';
import { ExecutionHistoryPort } from '../ports/out/ExecutionHistoryPort';
import { LlmClient, LlmError } from '../ports/out/LlmPort';
import { MeetingSourceError, MeetingSourcePort } from '../ports/out/MeetingSourcePort';
import { WorkspaceRepositoryPort } from '../ports/out/WorkspaceRepositoryPort';
import {
  EXTRACTION_SCHEMA,
  EXTRACTION_SCHEMA_NAME,
  Extraction,
  buildRequirementsDoc,
  mergeExtractions,
  validateExtraction,
} from './extraction';
import { EXTRACTION_SYSTEM_PROMPT, MAX_TRANSCRIPT_CHARS, buildExtractionUserMessage } from './extractionPrompt';
import { IntegrationsService, NotConfiguredError } from './IntegrationsService';
import { RequirementsService } from './RequirementsService';
import { chunkTranscript, normalizeTranscript } from './transcript';
import { parseMeetingInput } from './zoomLink';
import { priceFor } from './pricing';

// Meeting → requirements pipeline:
//   resolve input → fetch (Zoom MCP or uploaded text) → save snapshot →
//   LLM extraction (structured JSON, validated, one retry) → requirements.md.
// Every import creates its own requirement set in .specify/meetings/<setId>/,
// which is added to the workspace .gitignore so transcripts are never committed
// by accident. Features are created from a set later (FeatureCreationService).

export type ImportInput =
  | { type: 'link'; value: string }
  | { type: 'transcript'; text: string; filename?: string };

export type ImportRequest = {
  workspacePath: string;
  input: ImportInput;
  title?: string; // name for the new set; defaults to the meeting topic / file name
};

export type ImportOutcome = {
  status: ImportStatus;
  message: string;
  setId?: string;
  doc?: RequirementsDoc;
  added?: number;
  cost?: CostMetadata;
};

export const GITIGNORE_ENTRY = `${MEETINGS_DIR}/`;

const fail = (status: ImportStatus, message: string): ImportOutcome => ({ status, message });

export class MeetingImportService {
  constructor(
    private workspaceRepo: WorkspaceRepositoryPort,
    private requirements: RequirementsService,
    private integrations: IntegrationsService,
    private meetingSource: () => MeetingSourcePort,
    private executionHistory: ExecutionHistoryPort,
    private now: () => number = Date.now
  ) {}

  async import(req: ImportRequest, onProgress?: (p: ImportProgress) => void): Promise<ImportOutcome> {
    const { workspacePath, input } = req;

    // Check the cheap preconditions before touching Zoom or the LLM.
    let llm: { client: LlmClient; model: string };
    try {
      llm = await this.integrations.resolveLlm();
    } catch (err) {
      if (err instanceof NotConfiguredError) return fail('not_configured', err.message);
      throw err;
    }
    let meetingId: string | undefined;
    if (input.type === 'link') {
      const parsed = parseMeetingInput(input.value);
      if (parsed.kind === 'invalid') return fail('invalid_input', parsed.message);
      if (parsed.kind === 'unsupported') return fail('unsupported_link', parsed.message);
      meetingId = parsed.meetingId;
    } else if (!normalizeTranscript(input.text)) {
      return fail('invalid_input', 'The uploaded transcript is empty.');
    }

    const record = await this.executionHistory.start(workspacePath, {
      kind: 'meeting',
      feature: null,
      label: input.type === 'link' ? `Zoom meeting ${meetingId}` : `Transcript ${input.filename ?? 'upload'}`,
      command: input.type === 'link' ? 'zoom-mcp → requirements' : 'transcript → requirements',
    });
    const started = this.now();
    const progress = (step: ImportProgress['step'], message: string) => {
      this.executionHistory.appendLog(workspacePath, record.id, `${message}\n`);
      onProgress?.({ step, message });
    };

    let cost: CostMetadata | undefined;
    const finish = async (outcome: ImportOutcome): Promise<ImportOutcome> => {
      this.executionHistory.appendLog(workspacePath, record.id, `\n${outcome.status === 'ok' ? '✓' : '✗'} ${outcome.message}\n`);
      await this.executionHistory.finish(workspacePath, record.id, {
        status: outcome.status === 'ok' ? 'passed' : 'failed',
        exitCode: outcome.status === 'ok' ? 0 : 1,
        cost,
      });
      return { ...outcome, cost };
    };

    try {
      // 1. Fetch
      let snapshot: MeetingSnapshot;
      let raw: unknown;
      if (input.type === 'link') {
        progress('fetching', `Fetching meeting ${meetingId} from Zoom…`);
        try {
          const result = await this.meetingSource().fetchMeeting(meetingId!, m => progress('fetching', m));
          snapshot = result.snapshot;
          raw = result.raw;
        } catch (err) {
          if (err instanceof MeetingSourceError) {
            const status: ImportStatus = err.code === 'unavailable' ? 'source_error' : err.code;
            return finish(fail(status, err.message));
          }
          throw err;
        }
      } else {
        progress('fetching', `Reading ${input.filename ?? 'uploaded transcript'}…`);
        snapshot = { source: 'upload', transcript: normalizeTranscript(input.text) };
      }

      // 2. A new set, with the snapshot on disk (what the requirements are traceable to)
      const title = req.title?.trim() || snapshot.topic || input.type === 'transcript' && input.filename?.replace(/\.[^.]+$/, '') || 'Meeting';
      const setId = await this.requirements.newSetId(workspacePath, title, snapshot.startTime);
      const dir = setDir(setId);
      progress('saving', 'Saving the transcript…');
      await this.ensureGitignore(workspacePath);
      if (raw !== undefined) await this.workspaceRepo.writeFile(workspacePath, `${dir}/zoom-raw.json`, JSON.stringify(raw, null, 2));
      await this.workspaceRepo.writeFile(workspacePath, `${dir}/meeting.json`, JSON.stringify({
        source: snapshot.source, meetingId: snapshot.meetingId, topic: snapshot.topic,
        startTime: snapshot.startTime, importedAt: new Date(this.now()).toISOString(),
      }, null, 2));
      if (snapshot.transcript) await this.workspaceRepo.writeFile(workspacePath, `${dir}/transcript.md`, snapshot.transcript + '\n');
      if (snapshot.summary) await this.workspaceRepo.writeFile(workspacePath, `${dir}/summary.md`, snapshot.summary + '\n');
      if (!snapshot.transcript && snapshot.summary) {
        progress('fetching', 'No transcript available — extracting from the AI summary only.');
      }

      // 3. Extract
      const source = snapshot.transcript || snapshot.summary || '';
      const chunks = chunkTranscript(source, MAX_TRANSCRIPT_CHARS);
      const parts: Extraction[] = [];
      const rawOutputs: string[] = [];
      let inputTokens = 0;
      let outputTokens = 0;
      let model = llm.model;
      for (let i = 0; i < chunks.length; i++) {
        progress('extracting', chunks.length > 1
          ? `Extracting requirements with ${llm.model} (part ${i + 1} of ${chunks.length})…`
          : `Extracting requirements with ${llm.model}…`);
        const snapForPrompt = snapshot.transcript ? snapshot : { ...snapshot, summary: undefined };
        const result = await this.extractChunk(llm.client, buildExtractionUserMessage(snapForPrompt, chunks[i], { index: i, total: chunks.length }));
        inputTokens += result.inputTokens;
        outputTokens += result.outputTokens;
        model = result.model || model;
        if (result.raw) rawOutputs.push(result.raw);
        if (!result.extraction) {
          if (rawOutputs.length > 0) {
            await this.workspaceRepo.writeFile(workspacePath, `${dir}/extraction.json`, rawOutputs.join('\n\n'));
          }
          cost = this.cost(model, inputTokens, outputTokens, started);
          return finish(fail(result.status, result.error));
        }
        parts.push(result.extraction);
      }
      cost = this.cost(model, inputTokens, outputTokens, started);
      const extraction = mergeExtractions(parts);
      await this.workspaceRepo.writeFile(workspacePath, `${dir}/extraction.json`, JSON.stringify(extraction, null, 2));

      // 4. Write requirements.md
      progress('saving', `Saving ${extraction.requirements.length} requirement(s)…`);
      const doc = buildRequirementsDoc(extraction, snapshot);
      if (req.title?.trim()) doc.meta.title = req.title.trim();
      await this.requirements.save(workspacePath, setId, doc);

      const n = extraction.requirements.length;
      return finish({
        status: 'ok',
        message: n === 0
          ? 'The meeting didn’t contain any requirements the model could identify.'
          : `Added ${n} requirement${n === 1 ? '' : 's'} as drafts. Review and accept them, then create features from them.`,
        setId,
        doc,
        added: n,
      });
    } catch (err) {
      return finish(fail('llm_error', err instanceof Error ? err.message : String(err)));
    }
  }

  // One extraction call, validated; on invalid output, retries once with the error.
  private async extractChunk(client: LlmClient, user: string): Promise<{
    extraction?: Extraction; status: ImportStatus; error: string; raw: string;
    inputTokens: number; outputTokens: number; model: string;
  }> {
    let inputTokens = 0;
    let outputTokens = 0;
    let model = '';
    let lastRaw = '';
    let lastError = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const prompt = attempt === 0 ? user
        : `${user}\n\nYour previous answer was rejected: ${lastError}. Return only JSON that matches the required schema.`;
      try {
        const res = await client.completeJson({ system: EXTRACTION_SYSTEM_PROMPT, user: prompt, schemaName: EXTRACTION_SCHEMA_NAME, schema: EXTRACTION_SCHEMA as unknown as Record<string, unknown> });
        inputTokens += res.inputTokens ?? 0;
        outputTokens += res.outputTokens ?? 0;
        model = res.model;
        lastRaw = res.text;
        const v = validateExtraction(res.json);
        if (v.ok) return { extraction: v.value, status: 'ok', error: '', raw: res.text, inputTokens, outputTokens, model };
        lastError = v.error;
      } catch (err) {
        if (err instanceof LlmError && err.kind === 'invalid_json') {
          lastRaw = err.raw ?? '';
          lastError = 'it was not valid JSON';
          continue;
        }
        const message = err instanceof LlmError ? this.llmMessage(err) : err instanceof Error ? err.message : String(err);
        return { status: 'llm_error', error: message, raw: lastRaw, inputTokens, outputTokens, model };
      }
    }
    return {
      status: 'invalid_output',
      error: `The model’s answer didn’t match the requirements format (${lastError}). Its raw output was saved to meeting/extraction.json.`,
      raw: lastRaw, inputTokens, outputTokens, model,
    };
  }

  private llmMessage(err: LlmError): string {
    switch (err.kind) {
      case 'auth': return `The AI provider rejected your API key. Check it in Settings. (${err.message})`;
      case 'not_found': return `The selected model isn’t available for your API key. Pick another model in Settings. (${err.message})`;
      case 'rate_limit': return `The AI provider is rate-limiting your key. Try again in a minute. (${err.message})`;
      default: return err.message;
    }
  }

  private cost(model: string, inputTokens: number, outputTokens: number, started: number): CostMetadata {
    const price = priceFor(model);
    return {
      model,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      costUSD: (inputTokens * price.inputPerM + outputTokens * price.outputPerM) / 1_000_000,
      durationMs: this.now() - started,
      source: 'parsed',
    };
  }

  private async ensureGitignore(workspacePath: string): Promise<void> {
    const current = await this.workspaceRepo.readFile(workspacePath, '.gitignore');
    if (current.split('\n').some(l => l.trim() === GITIGNORE_ENTRY)) return;
    const sep = current && !current.endsWith('\n') ? '\n' : '';
    await this.workspaceRepo.writeFile(workspacePath, '.gitignore',
      `${current}${sep}${current ? '\n' : ''}# Meeting transcripts and requirements (speckit-assistant) — kept local\n${GITIGNORE_ENTRY}\n`);
  }
}
