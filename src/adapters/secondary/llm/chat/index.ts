import { ChatLlmClientFactory } from '../../../../domain/ports/out/ChatLlmPort';
import { AnthropicChatLlm } from './AnthropicChatLlm';
import { OpenAiChatLlm } from './OpenAiChatLlm';
import { GoogleChatLlm } from './GoogleChatLlm';

export const createChatLlmClient: ChatLlmClientFactory = (provider, apiKey, model) => {
  switch (provider) {
    case 'openai':
      return new OpenAiChatLlm(apiKey, model);
    case 'anthropic':
      return new AnthropicChatLlm(apiKey, model);
    case 'google':
      return new GoogleChatLlm(apiKey, model);
  }
};
