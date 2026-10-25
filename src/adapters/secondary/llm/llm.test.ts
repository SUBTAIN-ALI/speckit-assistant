import { describe, it, expect } from 'vitest';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { FinishReason } from '@google/genai';
import { OpenAiLlm } from './OpenAiLlm';
import { AnthropicLlm } from './AnthropicLlm';
import { GoogleLlm } from './GoogleLlm';
import { createLlmClient } from './index';
import { parseModelJson, kindForStatus } from './parseJson';
import { LlmError } from '../../../domain/ports/out/LlmPort';

const REQ = { system: 'sys', user: 'transcript', schemaName: 'meeting_requirements', schema: { type: 'object', additionalProperties: false, properties: { a: { type: 'object', additionalProperties: false } } } };
const OUT = { title: 't', requirements: [] };

async function* iter<T>(items: T[]) { for (const i of items) yield i; }

describe('parseJson helpers', () => {
  it('parses bare and fenced JSON, and reports invalid JSON with the raw text', () => {
    expect(parseModelJson(' {"a":1} ')).toEqual({ a: 1 });
    expect(parseModelJson('```json\n{"a":2}\n```')).toEqual({ a: 2 });
    const err = (() => { try { parseModelJson('nope'); } catch (e) { return e as LlmError; } })()!;
    expect(err.kind).toBe('invalid_json');
    expect(err.raw).toBe('nope');
  });
  it('maps statuses', () => {
    expect([401, 403, 404, 429, 400, 422, 500, undefined].map(kindForStatus)).toEqual(['auth', 'auth', 'not_found', 'rate_limit', 'bad_request', 'bad_request', 'unknown', 'network']);
  });
});

describe('OpenAiLlm', () => {
  const fake = (completion: any, captured: any[] = []) => ({
    chat: { completions: { create: async (p: any) => { captured.push(p); if (completion instanceof Error) throw completion; return completion; } } },
    models: { list: () => iter([{ id: 'gpt-5' }, { id: 'gpt-4o-audio-preview' }, { id: 'text-embedding-3' }, { id: 'o3' }]) },
  }) as unknown as OpenAI;

  it('sends a strict json_schema response format and reads usage', async () => {
    const captured: any[] = [];
    const llm = new OpenAiLlm('k', 'gpt-5', fake({ model: 'gpt-5-2026', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(OUT) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }, captured));
    const res = await llm.completeJson(REQ);
    expect(res).toMatchObject({ json: OUT, model: 'gpt-5-2026', inputTokens: 10, outputTokens: 5 });
    expect(captured[0].response_format).toEqual({ type: 'json_schema', json_schema: { name: 'meeting_requirements', schema: REQ.schema, strict: true } });
    expect(captured[0].messages).toEqual([{ role: 'system', content: 'sys' }, { role: 'user', content: 'transcript' }]);
  });

  it('reports refusals and truncation', async () => {
    await expect(new OpenAiLlm('k', 'm', fake({ choices: [{ message: { refusal: 'no' } }] })).completeJson(REQ)).rejects.toMatchObject({ kind: 'refusal' });
    await expect(new OpenAiLlm('k', 'm', fake({ choices: [{ finish_reason: 'length', message: { content: '{"a"' } }] })).completeJson(REQ)).rejects.toMatchObject({ kind: 'truncated' });
  });

  it('maps SDK errors', async () => {
    const authErr = new OpenAI.AuthenticationError(401, { message: 'bad key' }, 'bad key', new Headers());
    await expect(new OpenAiLlm('k', 'm', fake(authErr)).completeJson(REQ)).rejects.toMatchObject({ kind: 'auth' });
    await expect(new OpenAiLlm('k', 'm', fake(new Error('boom'))).completeJson(REQ)).rejects.toMatchObject({ kind: 'unknown' });
  });

  it('lists only chat models', async () => {
    expect(await new OpenAiLlm('k', 'm', fake({})).listModels()).toEqual(['gpt-5', 'o3']);
  });
});

describe('AnthropicLlm', () => {
  const fake = (message: any, captured: any[] = []) => ({
    beta: { messages: { stream: (p: any) => { captured.push(p); return { finalMessage: async () => { if (message instanceof Error) throw message; return message; } }; } } },
    models: { list: () => iter([{ id: 'claude-opus-5-5' }, { id: 'claude-haiku-5-5' }]) },
  }) as unknown as Anthropic;
  const msg = (extra: any = {}) => ({ model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(OUT) }], usage: { input_tokens: 20, output_tokens: 8 }, ...extra });

  it('uses structured outputs, effort and the refusal fallback on current models', async () => {
    const captured: any[] = [];
    const res = await new AnthropicLlm('k', 'claude-opus-5-5', fake(msg(), captured)).completeJson(REQ);
    expect(res).toMatchObject({ json: OUT, inputTokens: 20, outputTokens: 8 });
    expect(captured[0]).toMatchObject({
      model: 'claude-opus-5-5', system: 'sys', max_tokens: 64000,
      output_config: { format: { type: 'json_schema', schema: REQ.schema }, effort: 'high' },
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
    });
  });

  it('omits effort and fallbacks on older models', async () => {
    const captured: any[] = [];
    await new AnthropicLlm('k', 'claude-haiku-4-5', fake(msg(), captured)).completeJson(REQ);
    expect(captured[0].output_config).toEqual({ format: { type: 'json_schema', schema: REQ.schema } });
    expect(captured[0]).not.toHaveProperty('fallbacks');
  });

  it('reports refusal and max_tokens', async () => {
    await expect(new AnthropicLlm('k', 'claude-opus-5-5', fake(msg({ stop_reason: 'refusal', stop_details: { type: 'refusal', category: null, explanation: 'policy' } }))).completeJson(REQ))
      .rejects.toMatchObject({ kind: 'refusal', message: expect.stringContaining('policy') });
    await expect(new AnthropicLlm('k', 'claude-opus-5-5', fake(msg({ stop_reason: 'max_tokens' }))).completeJson(REQ)).rejects.toMatchObject({ kind: 'truncated' });
  });

  it('maps SDK errors and lists models', async () => {
    const err = new Anthropic.RateLimitError(429, { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }, 'slow down', new Headers());
    await expect(new AnthropicLlm('k', 'm', fake(err)).completeJson(REQ)).rejects.toMatchObject({ kind: 'rate_limit' });
    expect(await new AnthropicLlm('k', 'm', fake(msg())).listModels()).toEqual(['claude-opus-5-5', 'claude-haiku-5-5']);
  });
});

describe('GoogleLlm', () => {
  const fake = (response: any, captured: any[] = []) => ({
    models: {
      generateContent: async (p: any) => { captured.push(p); if (response instanceof Error) throw response; return response; },
      list: async () => iter([
        { name: 'models/gemini-2.5-flash', supportedActions: ['generateContent'] },
        { name: 'models/text-embedding-004', supportedActions: ['embedContent'] },
        { name: 'models/gemini-2.5-pro' },
      ]),
    },
  }) as any;

  it('requests JSON with the schema (minus additionalProperties) and reads usage', async () => {
    const captured: any[] = [];
    const res = await new GoogleLlm('k', 'gemini-2.5-flash', fake({ text: JSON.stringify(OUT), candidates: [{ finishReason: FinishReason.STOP }], usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3 }, modelVersion: 'gemini-2.5-flash-001' }, captured)).completeJson(REQ);
    expect(res).toMatchObject({ json: OUT, inputTokens: 7, outputTokens: 3, model: 'gemini-2.5-flash-001' });
    expect(captured[0].config).toEqual({ systemInstruction: 'sys', responseMimeType: 'application/json', responseJsonSchema: { type: 'object', properties: { a: { type: 'object' } } } });
  });

  it('reports safety blocks and truncation', async () => {
    await expect(new GoogleLlm('k', 'm', fake({ promptFeedback: { blockReason: 'SAFETY' } })).completeJson(REQ)).rejects.toMatchObject({ kind: 'refusal' });
    await expect(new GoogleLlm('k', 'm', fake({ text: '{', candidates: [{ finishReason: FinishReason.MAX_TOKENS }] })).completeJson(REQ)).rejects.toMatchObject({ kind: 'truncated' });
    await expect(new GoogleLlm('k', 'm', fake(new TypeError('fetch failed'))).completeJson(REQ)).rejects.toMatchObject({ kind: 'network' });
  });

  it('lists generateContent-capable Gemini models', async () => {
    expect(await new GoogleLlm('k', 'm', fake({})).listModels()).toEqual(['gemini-2.5-flash', 'gemini-2.5-pro']);
  });
});

describe('createLlmClient', () => {
  it('builds the adapter for each provider', () => {
    expect(createLlmClient('openai', 'k', 'm').provider).toBe('openai');
    expect(createLlmClient('anthropic', 'k', 'm').provider).toBe('anthropic');
    expect(createLlmClient('google', 'k', 'm').provider).toBe('google');
  });
});
