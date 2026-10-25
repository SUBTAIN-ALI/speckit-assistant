import OpenAI from 'openai';
import { LlmClient, LlmError, LlmJsonRequest, LlmJsonResponse } from '../../../domain/ports/out/LlmPort';
import { kindForStatus, parseModelJson } from './parseJson';

export class OpenAiLlm implements LlmClient {
  readonly provider = 'openai' as const;
  private client: OpenAI;

  constructor(apiKey: string, private model: string, client?: OpenAI) {
    this.client = client ?? new OpenAI({ apiKey });
  }

  async completeJson(req: LlmJsonRequest): Promise<LlmJsonResponse> {
    let completion: OpenAI.Chat.Completions.ChatCompletion;
    try {
      completion = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        // Strict structured outputs: the response is guaranteed to match the schema.
        response_format: {
          type: 'json_schema',
          json_schema: { name: req.schemaName, schema: req.schema, strict: true },
        },
      });
    } catch (err) {
      throw toLlmError(err);
    }

    const choice = completion.choices[0];
    if (choice?.message?.refusal) throw new LlmError('refusal', `The model declined: ${choice.message.refusal}`);
    if (choice?.finish_reason === 'length') {
      throw new LlmError('truncated', 'The model ran out of output tokens before finishing.', choice.message?.content ?? '');
    }
    const text = choice?.message?.content ?? '';
    return {
      text,
      json: parseModelJson(text),
      model: completion.model || this.model,
      inputTokens: completion.usage?.prompt_tokens,
      outputTokens: completion.usage?.completion_tokens,
    };
  }

  async listModels(): Promise<string[]> {
    try {
      const ids: string[] = [];
      for await (const m of this.client.models.list()) ids.push(m.id);
      // Only chat-capable families; the list also has embeddings, audio, images...
      return ids.filter(id => /^(gpt-|o\d|chatgpt-)/.test(id) && !/(audio|realtime|transcribe|tts|image|search|embedding)/.test(id)).sort();
    } catch (err) {
      throw toLlmError(err);
    }
  }
}

function toLlmError(err: unknown): LlmError {
  if (err instanceof OpenAI.APIConnectionError) return new LlmError('network', `Could not reach OpenAI: ${err.message}`);
  if (err instanceof OpenAI.APIError) return new LlmError(kindForStatus(err.status), `OpenAI: ${err.message}`);
  return new LlmError('unknown', err instanceof Error ? err.message : String(err));
}
