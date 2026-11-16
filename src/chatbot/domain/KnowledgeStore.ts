import { KnowledgeTopic, KnowledgeChange } from './models';

export interface KnowledgeStore {
  list(projectPath: string): Promise<KnowledgeTopic[]>;
  get(projectPath: string, slug: string): Promise<KnowledgeTopic | null>;
  prepareChange(projectPath: string, slug: string, title: string, proposedContent: string): Promise<KnowledgeChange>;
  save(projectPath: string, topic: KnowledgeTopic): Promise<void>;
  delete(projectPath: string, slug: string): Promise<void>;
  hasChanged(projectPath: string, slug: string, expectedContent: string | null): Promise<boolean>;
}
