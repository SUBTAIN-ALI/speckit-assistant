import * as crypto from 'crypto';
import { ConversationStore } from './ConversationStore';
import { KnowledgeStore } from './KnowledgeStore';
import { ChatbotAgentRunner } from '../adapters/ChatbotAgentRunner';
import { Conversation, ChatMessage, ConversationSummary } from './models';

export type ChatRequest = {
  conversationId?: string;
  message: string;
  projectPath: string;
};

export type ChatResponse = {
  conversationId: string;
  messageId: string;
  stream: AsyncIterable<string>;
  stop: () => void;
};

const MAX_HISTORY_EXCHANGES = 10;
const MAX_HISTORY_CHARS = 8000;
const MAX_MSG_CHARS = 500;

export class ChatbotService {
  private activeResponses = new Map<string, { stop: () => void }>();

  constructor(
    private conversationStore: ConversationStore,
    private knowledgeStore: KnowledgeStore,
    private agentRunner: ChatbotAgentRunner,
  ) {}

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const { message, projectPath } = request;

    let conversation: Conversation;
    if (request.conversationId) {
      const existing = await this.conversationStore.get(request.conversationId, projectPath);
      if (!existing) throw new Error('Conversation not found or expired');
      conversation = existing;
    } else {
      conversation = await this.conversationStore.create(projectPath);
    }

    const existing = this.activeResponses.get(conversation.id);
    if (existing) {
      existing.stop();
      this.activeResponses.delete(conversation.id);
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: message,
      status: 'complete',
      createdAt: new Date().toISOString(),
    };
    await this.conversationStore.appendMessage(conversation.id, projectPath, userMessage);

    const assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      status: 'streaming',
      createdAt: new Date().toISOString(),
    };
    await this.conversationStore.appendMessage(conversation.id, projectPath, assistantMessage);

    const history = this.formatHistory(conversation.messages);
    const session = await this.agentRunner.spawn(projectPath, message, history);

    this.activeResponses.set(conversation.id, { stop: session.stop });

    const convId = conversation.id;
    const store = this.conversationStore;
    const activeMap = this.activeResponses;

    const persistentStream = (async function* () {
      let accumulated = '';
      try {
        for await (const chunk of session.stream) {
          accumulated += chunk;
          yield chunk;
        }
        await store.updateLastMessage(convId, projectPath, {
          content: accumulated,
          status: 'complete',
        });
      } catch (err) {
        await store.updateLastMessage(convId, projectPath, {
          content: accumulated || 'An error occurred while generating the response.',
          status: accumulated ? 'complete' : 'error',
        }).catch(() => {});
        throw err;
      } finally {
        activeMap.delete(convId);
      }
    })();

    return {
      conversationId: conversation.id,
      messageId: assistantMessage.id,
      stream: persistentStream,
      stop: () => {
        session.stop();
        store.updateLastMessage(convId, projectPath, { status: 'canceled' }).catch(() => {});
        activeMap.delete(convId);
      },
    };
  }

  async getConversation(conversationId: string, projectPath: string): Promise<Conversation | null> {
    return this.conversationStore.get(conversationId, projectPath);
  }

  async listConversations(projectPath: string): Promise<ConversationSummary[]> {
    const convs = await this.conversationStore.list(projectPath);
    return convs.map(c => ({
      id: c.id,
      title: c.title,
      updatedAt: c.updatedAt,
      messageCount: c.messages.length,
    }));
  }

  async deleteConversation(conversationId: string, projectPath: string): Promise<void> {
    const active = this.activeResponses.get(conversationId);
    if (active) {
      active.stop();
      this.activeResponses.delete(conversationId);
    }
    return this.conversationStore.delete(conversationId, projectPath);
  }

  stopConversation(conversationId: string): boolean {
    const active = this.activeResponses.get(conversationId);
    if (active) {
      active.stop();
      this.activeResponses.delete(conversationId);
      return true;
    }
    return false;
  }

  private formatHistory(messages: ChatMessage[]): string {
    if (messages.length === 0) return '';
    const recent = messages.slice(-(MAX_HISTORY_EXCHANGES * 2));
    let result = '';
    for (const msg of recent) {
      const prefix = msg.role === 'user' ? 'User' : 'Assistant';
      const content = msg.content.length > MAX_MSG_CHARS
        ? msg.content.slice(0, MAX_MSG_CHARS) + '... [truncated]'
        : msg.content;
      result += `${prefix}: ${content}\n\n`;
      if (result.length > MAX_HISTORY_CHARS) break;
    }
    return result.trim();
  }
}
