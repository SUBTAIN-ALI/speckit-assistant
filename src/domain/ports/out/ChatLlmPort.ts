import { LlmProvider } from '../../models/credentials';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatLlmPort {
  streamChat(messages: ChatMessage[]): AsyncIterable<string>;
}

export type ChatLlmClientFactory = (provider: LlmProvider, apiKey: string, model: string) => ChatLlmPort;
