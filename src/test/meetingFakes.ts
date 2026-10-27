// In-memory test doubles for the meeting → requirements services.
import { WorkspaceRepositoryPort } from '../domain/ports/out/WorkspaceRepositoryPort';
import { CredentialStorePort } from '../domain/ports/out/CredentialStorePort';
import { ExecutionHistoryPort } from '../domain/ports/out/ExecutionHistoryPort';
import { LlmClient, LlmJsonRequest, LlmJsonResponse } from '../domain/ports/out/LlmPort';
import { IntegrationCredentials, LlmProvider } from '../domain/models/credentials';
import { ExecutionFinishPatch, ExecutionRecord, ExecutionStartInput } from '../domain/models/executions';
import { WorkflowState } from '../domain/models/types';

export class MemoryWorkspace implements WorkspaceRepositoryPort {
  files = new Map<string, string>();
  async readFile(_ws: string, p: string) { return this.files.get(p) ?? ''; }
  async writeFile(_ws: string, p: string, c: string) { this.files.set(p, c); }
  async listDirectories(_ws: string, dir: string) {
    const prefix = dir.replace(/\/$/, '') + '/';
    return [...new Set([...this.files.keys()].filter(k => k.startsWith(prefix) && k.slice(prefix.length).includes('/')).map(k => k.slice(prefix.length).split('/')[0]))].sort();
  }
  async deleteDirectory(_ws: string, dir: string) {
    const prefix = dir.replace(/\/$/, '') + '/';
    for (const k of [...this.files.keys()]) if (k.startsWith(prefix)) this.files.delete(k);
  }
  async getWorkflowState(): Promise<WorkflowState> { throw new Error('not used'); }
  async saveWorkflowState() { throw new Error('not used'); }
  async toggleTask(): Promise<WorkflowState> { throw new Error('not used'); }
  async toggleCheckbox(): Promise<void> { throw new Error('not used'); }
  async createFeature(): Promise<WorkflowState> { throw new Error('not used'); }
  async deleteFeature(): Promise<WorkflowState> { throw new Error('not used'); }
}

export class MemoryCredentials implements CredentialStorePort {
  constructor(public data: IntegrationCredentials = {}) {}
  async load() { return JSON.parse(JSON.stringify(this.data)) as IntegrationCredentials; }
  async save(c: IntegrationCredentials) { this.data = JSON.parse(JSON.stringify(c)); }
}

export class MemoryHistory implements ExecutionHistoryPort {
  records: Array<ExecutionRecord & { log: string }> = [];
  async start(_ws: string, input: ExecutionStartInput): Promise<ExecutionRecord> {
    const r = { ...input, id: `run-${this.records.length + 1}`, status: 'running' as const, startedAt: 0, logPath: 'x.log', log: '' };
    this.records.push(r);
    return r;
  }
  appendLog(_ws: string, id: string, text: string) { this.records.find(r => r.id === id)!.log += text; }
  async finish(_ws: string, id: string, patch: ExecutionFinishPatch) { Object.assign(this.records.find(r => r.id === id)!, patch); }
  async list() { return this.records; }
  async readLog(_ws: string, id: string) { return this.records.find(r => r.id === id)?.log ?? ''; }
}

// Returns queued responses (or throws queued errors) in order.
export class ScriptedLlm implements LlmClient {
  calls: LlmJsonRequest[] = [];
  constructor(public provider: LlmProvider, private script: Array<Partial<LlmJsonResponse> | Error>, private models: string[] = []) {}
  async completeJson(req: LlmJsonRequest): Promise<LlmJsonResponse> {
    this.calls.push(req);
    const next = this.script.shift();
    if (!next) throw new Error('ScriptedLlm: no more responses');
    if (next instanceof Error) throw next;
    const json = next.json;
    return { text: next.text ?? JSON.stringify(json), json, model: next.model ?? 'test-model', inputTokens: next.inputTokens ?? 100, outputTokens: next.outputTokens ?? 50 };
  }
  async listModels() { return this.models; }
}
