import { LlmProvider } from '../../models/credentials';
import { ChatLlmClientFactory, ChatMessage } from '../../ports/out/ChatLlmPort';
import { WorkspaceRepositoryPort } from '../../ports/out/WorkspaceRepositoryPort';
import { ProjectContextCollector } from './ProjectContextCollector';

export type ChatCredentialResolver = () => Promise<{ provider: LlmProvider; apiKey: string; model: string }>;

const SYSTEM_PREAMBLE = `You are a helpful project assistant. Answer the user's questions about this project based ONLY on the context provided below.
- If the answer is not in the context, say you don't have that information.
- Do not make up information or speculate beyond what the project documents state.
- Be concise and direct. Use Markdown formatting when helpful.
- You cannot modify any files or code. You are read-only.`;

export class ChatService {
  private contextCollector: ProjectContextCollector;

  constructor(
    workspaceRepo: WorkspaceRepositoryPort,
    private chatLlmFactory: ChatLlmClientFactory,
    private resolveCredentials: ChatCredentialResolver,
  ) {
    this.contextCollector = new ProjectContextCollector(workspaceRepo);
  }

  async *chat(workspacePath: string, messages: ChatMessage[]): AsyncGenerator<string> {
    const projectContext = await this.contextCollector.collect(workspacePath);
    const { provider, apiKey, model } = await this.resolveCredentials();
    const client = this.chatLlmFactory(provider, apiKey, model);

    const systemMessage: ChatMessage = {
      role: 'system',
      content: `${SYSTEM_PREAMBLE}\n\n# Project Context\n\n${projectContext}`,
    };

    for await (const chunk of client.streamChat([systemMessage, ...messages])) {
      yield chunk;
    }
  }
}
