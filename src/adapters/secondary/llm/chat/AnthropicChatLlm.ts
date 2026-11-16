import Anthropic from '@anthropic-ai/sdk';
import { ChatLlmPort, ChatMessage } from '../../../../domain/ports/out/ChatLlmPort';

export class AnthropicChatLlm implements ChatLlmPort {
  private client: Anthropic;

  constructor(apiKey: string, private model: string) {
    this.client = new Anthropic({ apiKey });
  }

  async *streamChat(messages: ChatMessage[]): AsyncIterable<string> {
    const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
    const conversationMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: 4096,
      system,
      messages: conversationMessages,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
    }
  }
}
