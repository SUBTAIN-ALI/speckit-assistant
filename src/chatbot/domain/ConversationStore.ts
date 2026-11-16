import { Conversation, ChatMessage } from './models';

export interface ConversationStore {
  create(projectPath: string): Promise<Conversation>;
  get(id: string, projectPath: string): Promise<Conversation | null>;
  list(projectPath: string): Promise<Conversation[]>;
  appendMessage(conversationId: string, projectPath: string, message: ChatMessage): Promise<void>;
  updateLastMessage(conversationId: string, projectPath: string, update: Partial<ChatMessage>): Promise<void>;
  delete(conversationId: string, projectPath: string): Promise<void>;
  prune(projectPath: string): Promise<number>;
}
