import Anthropic from '@anthropic-ai/sdk';
import { LlmClient, LlmError, LlmJsonRequest, LlmJsonResponse } from '../../../domain/ports/out/LlmPort';
import { kindForStatus, parseModelJson } from './parseJson';

// Models that accept output_config.effort (older ones reject it with a 400).
const EFFORT_MODELS = /^claude-(opus-5|opus-4-[5-9]|sonnet-5|sonnet-4-6|haiku-5|fable)/;
// Models that support the server-side refusal fallback ("default" routing).
const FALLBACK_MODELS = /^claude-(opus-5-5|opus-5|fable-5-1|sonnet-5-5)$/;

export class AnthropicLlm implements LlmClient {
  readonly provider = 'anthropic' as const;
  private client: Anthropic;

  constructor(apiKey: string, private model: string, client?: Anthropic) {
    this.client = client ?? new Anthropic({ apiKey });
  }

  async completeJson(req: LlmJsonRequest): Promise<LlmJsonResponse> {
    const fallback = FALLBACK_MODELS.test(this.model);
    let message: Anthropic.Beta.BetaMessage;
    try {
      // Streamed because a long transcript plus a large requirements list can
      // exceed the non-streaming request timeout; finalMessage() assembles it.
      const stream = this.client.beta.messages.stream({
        model: this.model,
        max_tokens: 64000,
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
        output_config: {
          format: { type: 'json_schema', schema: req.schema },
          // Extraction quality is the whole feature; worth the extra thinking.
          ...(EFFORT_MODELS.test(this.model) ? { effort: 'high' as const } : {}),
        },
        // If a safety classifier declines, re-run on a suitable model instead of failing.
        ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      });
      message = await stream.finalMessage();
    } catch (err) {
      throw toLlmError(err);
    }

    if (message.stop_reason === 'refusal') {
      const why = message.stop_details && 'explanation' in message.stop_details ? message.stop_details.explanation : '';
      throw new LlmError('refusal', `Claude declined this request${why ? `: ${why}` : '.'}`);
    }
    const text = message.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map(b => b.text)
      .join('');
    if (message.stop_reason === 'max_tokens') {
      throw new LlmError('truncated', 'Claude ran out of output tokens before finishing.', text);
    }
    return {
      text,
      json: parseModelJson(text),
      model: message.model || this.model,
      inputTokens: message.usage?.input_tokens,
      outputTokens: message.usage?.output_tokens,
    };
  }

  async listModels(): Promise<string[]> {
    try {
      const ids: string[] = [];
      for await (const m of this.client.models.list()) ids.push(m.id);
      return ids;
    } catch (err) {
      throw toLlmError(err);
    }
  }
}

function toLlmError(err: unknown): LlmError {
  if (err instanceof Anthropic.APIConnectionError) return new LlmError('network', `Could not reach Anthropic: ${err.message}`);
  if (err instanceof Anthropic.APIError) return new LlmError(kindForStatus(err.status), `Anthropic: ${err.message}`);
  return new LlmError('unknown', err instanceof Error ? err.message : String(err));
}
