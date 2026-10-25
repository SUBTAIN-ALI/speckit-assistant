import { LlmError } from '../../../domain/ports/out/LlmPort';

// Structured-output modes return bare JSON, but tolerate a ```json fence in case
// a model or proxy wraps it anyway.
export function parseModelJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed);
  try {
    return JSON.parse(fenced ? fenced[1] : trimmed);
  } catch {
    throw new LlmError('invalid_json', 'The model did not return valid JSON.', text);
  }
}

// Maps an HTTP status from any provider SDK error to our error kinds.
export function kindForStatus(status: number | undefined): LlmError['kind'] {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limit';
  if (status === 400 || status === 422) return 'bad_request';
  if (status === undefined) return 'network';
  return 'unknown';
}
