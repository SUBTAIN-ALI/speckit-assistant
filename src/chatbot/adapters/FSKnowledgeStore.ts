import * as fs from 'fs/promises';
import * as path from 'path';
import { KnowledgeStore } from '../domain/KnowledgeStore';
import { KnowledgeTopic, KnowledgeChange } from '../domain/models';

const KNOWLEDGE_DIR = '.specify/chatbot/knowledge';
const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function parseFrontmatter(raw: string): { title: string; updatedAt: string; content: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { title: '', updatedAt: '', content: raw.trim() };
  const meta = match[1];
  const content = match[2].trim();
  const title = /^title:\s*(.+)$/m.exec(meta)?.[1]?.trim() ?? '';
  const updatedAt = /^updatedAt:\s*(.+)$/m.exec(meta)?.[1]?.trim() ?? '';
  return { title, updatedAt, content };
}

function toMarkdown(topic: KnowledgeTopic): string {
  return `---\ntitle: ${topic.title}\nupdatedAt: ${topic.updatedAt}\n---\n\n${topic.content}\n`;
}

export class FSKnowledgeStore implements KnowledgeStore {
  private dir(projectPath: string): string {
    return path.join(projectPath, KNOWLEDGE_DIR);
  }

  private filePath(projectPath: string, slug: string): string {
    return path.join(this.dir(projectPath), `${slug}.md`);
  }

  private validateSlug(slug: string): void {
    if (!SLUG_REGEX.test(slug)) {
      throw new Error(`Invalid knowledge slug: "${slug}". Use lowercase letters, numbers, and hyphens only.`);
    }
    if (slug.includes('..') || slug.includes('/') || slug.includes('\\')) {
      throw new Error(`Invalid knowledge slug: "${slug}". Path traversal not allowed.`);
    }
  }

  async list(projectPath: string): Promise<KnowledgeTopic[]> {
    const dir = this.dir(projectPath);
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return [];
    }
    const topics: KnowledgeTopic[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue;
      const slug = entry.replace(/\.md$/, '');
      try {
        const raw = await fs.readFile(path.join(dir, entry), 'utf-8');
        const { title, updatedAt, content } = parseFrontmatter(raw);
        topics.push({ slug, title, updatedAt, content });
      } catch {
        // skip
      }
    }
    topics.sort((a, b) => a.slug.localeCompare(b.slug));
    return topics;
  }

  async get(projectPath: string, slug: string): Promise<KnowledgeTopic | null> {
    try {
      const raw = await fs.readFile(this.filePath(projectPath, slug), 'utf-8');
      const { title, updatedAt, content } = parseFrontmatter(raw);
      return { slug, title, updatedAt, content };
    } catch {
      return null;
    }
  }

  async prepareChange(projectPath: string, slug: string, title: string, proposedContent: string): Promise<KnowledgeChange> {
    const existing = await this.get(projectPath, slug);
    if (!existing) {
      return { slug, title, previousContent: null, proposedContent, isConflict: false };
    }
    const existingParagraphs = existing.content.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
    const proposedParagraphs = proposedContent.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
    const hasLostContent = existingParagraphs.some(ep => {
      if (proposedContent.includes(ep)) return false;
      return !proposedParagraphs.some(pp => pp.includes(ep) || ep.includes(pp));
    });
    return {
      slug,
      title,
      previousContent: existing.content,
      proposedContent,
      isConflict: hasLostContent,
    };
  }

  async save(projectPath: string, topic: KnowledgeTopic): Promise<void> {
    this.validateSlug(topic.slug);
    await fs.mkdir(this.dir(projectPath), { recursive: true });
    await fs.writeFile(this.filePath(projectPath, topic.slug), toMarkdown(topic), 'utf-8');
  }

  async delete(projectPath: string, slug: string): Promise<void> {
    try {
      await fs.unlink(this.filePath(projectPath, slug));
    } catch {
      // already gone
    }
  }

  async hasChanged(projectPath: string, slug: string, expectedContent: string | null): Promise<boolean> {
    const current = await this.get(projectPath, slug);
    if (!current && expectedContent === null) return false;
    if (!current && expectedContent !== null) return true;
    if (current && expectedContent === null) return true;
    return current!.content !== expectedContent;
  }
}
