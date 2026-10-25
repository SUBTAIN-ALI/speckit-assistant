import { ApiError, FinishReason, GoogleGenAI } from '@google/genai';
import { LlmClient, LlmError, LlmJsonRequest, LlmJsonResponse } from '../../../domain/ports/out/LlmPort';
import { kindForStatus, parseModelJson } from './parseJson';

// Gemini's JSON-schema mode accepts a subset of JSON Schema; strip the keyword
// it is least consistent about. The app validates the result itself anyway.
function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (k === 'additionalProperties') continue;
    out[k] = toGeminiSchema(v);
  }
  return out;
}

export class GoogleLlm implements LlmClient {
  readonly provider = 'google' as const;
  private client: GoogleGenAI;

  constructor(apiKey: string, private model: string, client?: GoogleGenAI) {
    this.client = client ?? new GoogleGenAI({ apiKey });
  }

  async completeJson(req: LlmJsonRequest): Promise<LlmJsonResponse> {
    let response: Awaited<ReturnType<GoogleGenAI['models']['generateContent']>>;
    try {
      response = await this.client.models.generateContent({
        model: this.model,
        contents: req.user,
        config: {
          systemInstruction: req.system,
          responseMimeType: 'application/json',
          responseJsonSchema: toGeminiSchema(req.schema),
        },
      });
    } catch (err) {
      throw toLlmError(err);
    }

    const candidate = response.candidates?.[0];
    if (response.promptFeedback?.blockReason || candidate?.finishReason === FinishReason.SAFETY) {
      throw new LlmError('refusal', 'Gemini blocked this request for safety reasons.');
    }
    const text = response.text ?? '';
    if (candidate?.finishReason === FinishReason.MAX_TOKENS) {
      throw new LlmError('truncated', 'Gemini ran out of output tokens before finishing.', text);
    }
    return {
      text,
      json: parseModelJson(text),
      model: response.modelVersion || this.model,
      inputTokens: response.usageMetadata?.promptTokenCount,
      outputTokens: response.usageMetadata?.candidatesTokenCount,
    };
  }

  async listModels(): Promise<string[]> {
    try {
      const ids: string[] = [];
      const pager = await this.client.models.list();
      for await (const m of pager) {
        const actions = m.supportedActions ?? [];
        if (m.name && (actions.length === 0 || actions.includes('generateContent'))) {
          ids.push(m.name.replace(/^models\//, ''));
        }
      }
      return ids.filter(id => id.startsWith('gemini')).sort();
    } catch (err) {
      throw toLlmError(err);
    }
  }
}

function toLlmError(err: unknown): LlmError {
  if (err instanceof ApiError) return new LlmError(kindForStatus(err.status), `Gemini: ${err.message}`);
  if (err instanceof TypeError) return new LlmError('network', `Could not reach Gemini: ${err.message}`);
  return new LlmError('unknown', err instanceof Error ? err.message : String(err));
}
