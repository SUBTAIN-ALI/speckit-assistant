import { GoogleGenAI } from '@google/genai';
import { ChatLlmPort, ChatMessage } from '../../../../domain/ports/out/ChatLlmPort';

export class GoogleChatLlm implements ChatLlmPort {
  private client: GoogleGenAI;

  constructor(apiKey: string, private model: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async *streamChat(messages: ChatMessage[]): AsyncIterable<string> {
    const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
    const conversationMessages = messages.filter(m => m.role !== 'system');

    const contents = conversationMessages.map(m => ({
      role: m.role === 'assistant' ? 'model' as const : 'user' as const,
      parts: [{ text: m.content }],
    }));

    const response = await this.client.models.generateContentStream({
      model: this.model,
      contents,
      config: { systemInstruction: system },
    });

    for await (const chunk of response) {
      const text = chunk.text;
      if (text) yield text;
    }
  }
}
