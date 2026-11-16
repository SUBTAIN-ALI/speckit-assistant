import OpenAI from 'openai';
import { ChatLlmPort, ChatMessage } from '../../../../domain/ports/out/ChatLlmPort';

export class OpenAiChatLlm implements ChatLlmPort {
  private client: OpenAI;

  constructor(apiKey: string, private model: string) {
    this.client = new OpenAI({ apiKey });
  }

  async *streamChat(messages: ChatMessage[]): AsyncIterable<string> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      stream: true,
    });

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content;
      if (text) yield text;
    }
  }
}
