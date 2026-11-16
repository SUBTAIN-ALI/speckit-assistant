import { KnowledgeStore } from '../domain/KnowledgeStore';
import { KnowledgeTopic, KnowledgeChange } from '../domain/models';
import { DocumentExtractor, SupportedFormat } from '../adapters/DocumentExtractor';

export type KnowledgeHandlers = {
  list(workspacePath: string): Promise<KnowledgeTopic[]>;
  prepare(workspacePath: string, body: { slug: string; title: string; content: string }): Promise<KnowledgeChange>;
  save(workspacePath: string, body: { slug: string; title: string; content: string }): Promise<void>;
  deleteTopic(workspacePath: string, slug: string): Promise<void>;
  upload(workspacePath: string, filePath: string, filename: string): Promise<{ text: string; format: SupportedFormat }>;
};

export function createKnowledgeHandlers(
  knowledgeStore: KnowledgeStore,
  extractor: DocumentExtractor,
): KnowledgeHandlers {
  return {
    async list(workspacePath) {
      return knowledgeStore.list(workspacePath);
    },

    async prepare(workspacePath, body) {
      if (!body.slug || !body.title || !body.content) {
        throw new Error('slug, title, and content are required');
      }
      return knowledgeStore.prepareChange(workspacePath, body.slug, body.title, body.content);
    },

    async save(workspacePath, body) {
      if (!body.slug || !body.title || !body.content) {
        throw new Error('slug, title, and content are required');
      }
      const topic: KnowledgeTopic = {
        slug: body.slug,
        title: body.title,
        content: body.content,
        updatedAt: new Date().toISOString(),
      };
      await knowledgeStore.save(workspacePath, topic);
    },

    async deleteTopic(workspacePath, slug) {
      await knowledgeStore.delete(workspacePath, slug);
    },

    async upload(workspacePath, filePath, filename) {
      const format = extractor.detectFormat(filename);
      if (!format) {
        throw new Error(`Unsupported file format. Supported: PDF, DOCX, MD, TXT`);
      }
      const text = await extractor.extract(filePath, format);
      return { text, format };
    },
  };
}
