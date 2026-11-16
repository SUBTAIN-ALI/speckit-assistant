export type { ChatbotHostPort, ChatAgentSession } from './domain/ports';
export type {
  Conversation,
  ChatMessage,
  ChatRole,
  MessageStatus,
  CitationSource,
  KnowledgeTopic,
  KnowledgeChange,
  ChatState,
  ConversationSummary,
} from './domain/models';
export type { ChatHandlers } from './api/handlers';
export type { KnowledgeHandlers } from './api/knowledgeHandlers';
export type { EvidenceType, EvidenceSpan } from './domain/EvidenceParser';

export { ChatbotService } from './domain/ChatbotService';
export { ChatbotAgentRunner } from './adapters/ChatbotAgentRunner';
export { FSConversationStore } from './adapters/FSConversationStore';
export { FSKnowledgeStore } from './adapters/FSKnowledgeStore';
export { FSDocumentExtractor } from './adapters/DocumentExtractor';
export { FileAccessGuard } from './domain/FileAccessGuard';
export { parseCitations, stripCitations, extractUniqueSources } from './domain/CitationParser';
export { parseEvidence, hasEvidence, getEvidenceLabel, getEvidenceColor } from './domain/EvidenceParser';
export { createChatHandlers } from './api/handlers';
export { createKnowledgeHandlers } from './api/knowledgeHandlers';
