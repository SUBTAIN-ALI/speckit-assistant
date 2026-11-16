import { ChatbotService, ChatResponse } from '../domain/ChatbotService';
import { ConversationSummary, Conversation } from '../domain/models';

export type ChatHandlers = {
  chat(body: { conversationId?: string; message: string }, workspacePath: string): Promise<ChatResponse>;
  listConversations(workspacePath: string): Promise<ConversationSummary[]>;
  getConversation(id: string, workspacePath: string): Promise<Conversation>;
  deleteConversation(id: string, workspacePath: string): Promise<void>;
  stopConversation(id: string): boolean;
};

export function createChatHandlers(chatbotService: ChatbotService): ChatHandlers {
  return {
    async chat(body, workspacePath) {
      if (!body.message || typeof body.message !== 'string' || !body.message.trim()) {
        throw new Error('message is required and must be a non-empty string');
      }
      return chatbotService.chat({
        conversationId: body.conversationId,
        message: body.message.trim(),
        projectPath: workspacePath,
      });
    },

    async listConversations(workspacePath) {
      return chatbotService.listConversations(workspacePath);
    },

    async getConversation(id, workspacePath) {
      const conv = await chatbotService.getConversation(id, workspacePath);
      if (!conv) throw new Error('Conversation not found');
      return conv;
    },

    async deleteConversation(id, workspacePath) {
      await chatbotService.deleteConversation(id, workspacePath);
    },

    stopConversation(id) {
      return chatbotService.stopConversation(id);
    },
  };
}
