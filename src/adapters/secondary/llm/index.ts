import { LlmClientFactory } from '../../../domain/ports/out/LlmPort';
import { OpenAiLlm } from './OpenAiLlm';
import { AnthropicLlm } from './AnthropicLlm';
import { GoogleLlm } from './GoogleLlm';

export const createLlmClient: LlmClientFactory = (provider, apiKey, model) => {
  switch (provider) {
    case 'openai':
      return new OpenAiLlm(apiKey, model);
    case 'anthropic':
      return new AnthropicLlm(apiKey, model);
    case 'google':
      return new GoogleLlm(apiKey, model);
  }
};
