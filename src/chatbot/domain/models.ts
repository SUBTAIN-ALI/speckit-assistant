export type ChatRole = 'user' | 'assistant';

export type CitationSource = {
  type: 'file' | 'spec' | 'requirement' | 'review' | 'meeting' | 'knowledge' | 'git';
  path: string;
  lineStart?: number;
  lineEnd?: number;
  snippet?: string;
  label?: string;
};

export type MessageStatus = 'complete' | 'streaming' | 'canceled' | 'error';

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  status: MessageStatus;
  citations?: CitationSource[];
  createdAt: string;
};

export type Conversation = {
  id: string;
  projectPath: string;
  title?: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
};

export type ConversationSummary = {
  id: string;
  title?: string;
  updatedAt: string;
  messageCount: number;
};

export type KnowledgeTopic = {
  slug: string;
  title: string;
  content: string;
  updatedAt: string;
};

export type KnowledgeChange = {
  slug: string;
  title: string;
  previousContent: string | null;
  proposedContent: string;
  isConflict: boolean;
};

export type ChatState =
  | 'ready'
  | 'investigating'
  | 'files-changing'
  | 'error'
  | 'agent-unavailable';
