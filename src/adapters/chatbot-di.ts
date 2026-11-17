import { ChatbotHostPort, ChatAgentSession } from '../chatbot/domain/ports';
import { WorkflowStateSummary } from '../chatbot/domain/host-types';
import { ChatbotAgentRunner } from '../chatbot/adapters/ChatbotAgentRunner';
import { FSConversationStore } from '../chatbot/adapters/FSConversationStore';
import { FSKnowledgeStore } from '../chatbot/adapters/FSKnowledgeStore';
import { ChatbotService } from '../chatbot/domain/ChatbotService';
import { createChatHandlers } from '../chatbot/api/handlers';
import { createKnowledgeHandlers } from '../chatbot/api/knowledgeHandlers';
import { FSDocumentExtractor } from '../chatbot/adapters/DocumentExtractor';
import { workflowService, integrationsService, agentRepository, zoomAuth } from './di';
import { getWorkspacePath } from './primary/api/utils';
import { activeAgent, toAgentConfig, DEFAULT_AGENTS } from '../domain/models/agents';
import { AgentConfig } from '../domain/models/types';
import { ProcessAgentRunner, AgentEnvProvider } from './secondary/agent/ProcessAgentRunner';
import { ZOOM_TOKEN_ENV } from '../domain/models/mcp';

const envProvider: AgentEnvProvider = async (): Promise<Record<string, string>> => {
  try {
    const token = await zoomAuth.getAccessToken();
    return { [ZOOM_TOKEN_ENV]: token };
  } catch {
    return {};
  }
};

const globalForChatbot = globalThis as unknown as {
  speckitChatbotSessions?: Map<string, any>;
  speckitAgentSessions?: Map<string, any>;
};
const chatbotSessions = globalForChatbot.speckitChatbotSessions ??= new Map();
const mainAgentSessions = globalForChatbot.speckitAgentSessions;
const chatbotAgentRunnerProcess = new ProcessAgentRunner(envProvider, chatbotSessions);

class SpecRabbitChatbotHost implements ChatbotHostPort {
  getWorkspacePath(): string {
    return getWorkspacePath();
  }

  getAgentConfig(): AgentConfig {
    try {
      // agentRepository is async; for the synchronous host port we fall back to
      // a cached promise or the default. The real config is loaded lazily.
      const ws = getWorkspacePath();
      // Synchronous access: read from the last cached value or default.
      if (!this._agentConfigCache) {
        agentRepository.getAgents(ws).then(file => {
          this._agentConfigCache = file;
        }).catch(() => {});
      }
      const file = this._agentConfigCache || DEFAULT_AGENTS;
      const agent = activeAgent(file);
      return agent ? toAgentConfig(agent) : { agentType: 'claude' };
    } catch {
      return { agentType: 'claude' };
    }
  }

  private _agentConfigCache: any = null;

  async resolveCredentials() {
    return integrationsService.resolveKey();
  }

  async spawnReadOnlyAgent(workspacePath: string, prompt: string): Promise<ChatAgentSession> {
    const agentConfig = this.getAgentConfig();
    let accumulated = '';
    let resolveDone: (code: number) => void;
    const donePromise = new Promise<number>(r => { resolveDone = r; });
    let stopped = false;
    const key = `chatbot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let responseStarted = false;

    const exitPromise = chatbotAgentRunnerProcess.runCommand(
      workspacePath,
      {
        key,
        command: '',
        context: prompt,
      },
      agentConfig,
      (text: string) => {
        const lines = text.split('\n');
        const filtered: string[] = [];

        for (const line of lines) {
          const trimmed = line.trim();

          if (!responseStarted) {
            if (/^▶/.test(trimmed)) responseStarted = true;
            continue;
          }

          if (!trimmed) { filtered.push(line); continue; }
          if (/^\$[\d,.]+$/.test(trimmed)) continue;
          if (/^Running:/.test(trimmed)) continue;
          if (/^Process exited with code/.test(trimmed)) continue;
          if (/^[▶✓✗→]/.test(trimmed)) continue;
          if (/^Done\b|^✓ Done|^✗ Finished/.test(trimmed)) continue;

          filtered.push(line);
        }

        const result = filtered.join('\n');
        if (result) accumulated += result;
      },
    );

    exitPromise.then(code => resolveDone!(code)).catch(() => resolveDone!(1));

    const stream = (async function* () {
      let lastLen = 0;
      while (true) {
        await new Promise(r => setTimeout(r, 100));
        if (stopped) break;
        if (accumulated.length > lastLen) {
          const newText = accumulated.slice(lastLen);
          lastLen = accumulated.length;
          yield newText;
        }
        const code = await Promise.race([
          donePromise.then(c => c as number | null),
          new Promise<null>(r => setTimeout(() => r(null), 50)),
        ]);
        if (code !== null) {
          if (accumulated.length > lastLen) {
            yield accumulated.slice(lastLen);
          }
          break;
        }
      }
    })();

    return {
      stream,
      stop: () => {
        stopped = true;
        chatbotSessions.delete(key);
      },
      isRunning: () => !stopped && chatbotSessions.has(key),
    };
  }

  async getWorkflowState(workspacePath: string): Promise<WorkflowStateSummary> {
    const state = await workflowService.getWorkflowState(workspacePath);
    return {
      features: state.features.map(f => ({
        name: f.name,
        phases: f.phases.map(p => ({ phase: p.phase, status: p.status })),
      })),
      activeFeatureName: state.activeFeatureName,
    };
  }

  isImplementationRunning(_workspacePath: string): boolean {
    const sessions = mainAgentSessions;
    if (!sessions) return false;
    for (const [key] of sessions) {
      if (key.endsWith('-implementation')) return true;
    }
    return false;
  }
}

const chatbotHost = new SpecRabbitChatbotHost();
const conversationStore = new FSConversationStore();
const knowledgeStore = new FSKnowledgeStore();
const chatbotAgentRunner = new ChatbotAgentRunner(chatbotHost, knowledgeStore);
const chatbotService = new ChatbotService(conversationStore, knowledgeStore, chatbotAgentRunner);

const documentExtractor = new FSDocumentExtractor();

export const chatHandlers = createChatHandlers(chatbotService);
export const knowledgeHandlers = createKnowledgeHandlers(knowledgeStore, documentExtractor);
export { chatbotService, knowledgeStore };

export async function getChatbotStatus(workspacePath: string) {
  const implRunning = chatbotHost.isImplementationRunning(workspacePath);
  const state = await chatbotHost.getWorkflowState(workspacePath);
  return {
    implementationRunning: implRunning,
    activeFeature: state.activeFeatureName ?? undefined,
  };
}
