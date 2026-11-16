import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { ConversationStore } from '../domain/ConversationStore';
import { Conversation, ChatMessage } from '../domain/models';

const CONVERSATIONS_DIR = '.specify/chatbot/conversations';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_TITLE_LEN = 80;

function deriveTitle(text: string): string {
  if (text.length <= MAX_TITLE_LEN) return text.trim();
  const truncated = text.slice(0, MAX_TITLE_LEN);
  const lastSpace = truncated.lastIndexOf(' ');
  return lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated;
}

export class FSConversationStore implements ConversationStore {
  private dir(projectPath: string): string {
    return path.join(projectPath, CONVERSATIONS_DIR);
  }

  private filePath(projectPath: string, id: string): string {
    return path.join(this.dir(projectPath), `${id}.json`);
  }

  private async ensureDir(projectPath: string): Promise<void> {
    await fs.mkdir(this.dir(projectPath), { recursive: true });
  }

  private async atomicWrite(filePath: string, data: string): Promise<void> {
    const tmp = filePath + `.tmp.${crypto.randomUUID().slice(0, 8)}`;
    await fs.writeFile(tmp, data, 'utf-8');
    await fs.rename(tmp, filePath);
  }

  async create(projectPath: string): Promise<Conversation> {
    await this.ensureDir(projectPath);
    const now = new Date().toISOString();
    const conv: Conversation = {
      id: crypto.randomUUID(),
      projectPath,
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    await this.atomicWrite(this.filePath(projectPath, conv.id), JSON.stringify(conv, null, 2));
    return conv;
  }

  async get(id: string, projectPath: string): Promise<Conversation | null> {
    if (!this.isSafeId(id)) return null;
    try {
      const raw = await fs.readFile(this.filePath(projectPath, id), 'utf-8');
      return JSON.parse(raw) as Conversation;
    } catch {
      return null;
    }
  }

  async list(projectPath: string): Promise<Conversation[]> {
    await this.prune(projectPath);
    const dir = this.dir(projectPath);
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return [];
    }
    const conversations: Conversation[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      try {
        const raw = await fs.readFile(path.join(dir, entry), 'utf-8');
        conversations.push(JSON.parse(raw));
      } catch {
        // skip corrupted files
      }
    }
    conversations.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return conversations;
  }

  async appendMessage(conversationId: string, projectPath: string, message: ChatMessage): Promise<void> {
    const conv = await this.get(conversationId, projectPath);
    if (!conv) throw new Error(`Conversation ${conversationId} not found`);
    conv.messages.push(message);
    conv.updatedAt = new Date().toISOString();
    if (!conv.title && message.role === 'user') {
      conv.title = deriveTitle(message.content);
    }
    await this.atomicWrite(this.filePath(projectPath, conversationId), JSON.stringify(conv, null, 2));
  }

  async updateLastMessage(conversationId: string, projectPath: string, update: Partial<ChatMessage>): Promise<void> {
    const conv = await this.get(conversationId, projectPath);
    if (!conv || conv.messages.length === 0) return;
    const last = conv.messages[conv.messages.length - 1];
    Object.assign(last, update);
    conv.updatedAt = new Date().toISOString();
    await this.atomicWrite(this.filePath(projectPath, conversationId), JSON.stringify(conv, null, 2));
  }

  async delete(conversationId: string, projectPath: string): Promise<void> {
    if (!this.isSafeId(conversationId)) return;
    try {
      await fs.unlink(this.filePath(projectPath, conversationId));
    } catch {
      // already gone
    }
  }

  async prune(projectPath: string): Promise<number> {
    const dir = this.dir(projectPath);
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return 0;
    }
    let pruned = 0;
    const cutoff = Date.now() - TTL_MS;
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      try {
        const raw = await fs.readFile(path.join(dir, entry), 'utf-8');
        const conv = JSON.parse(raw) as Conversation;
        if (new Date(conv.updatedAt).getTime() < cutoff) {
          await fs.unlink(path.join(dir, entry));
          pruned++;
        }
      } catch {
        // skip
      }
    }
    return pruned;
  }

  private isSafeId(id: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
  }
}
