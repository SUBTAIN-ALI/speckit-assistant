import { FSWorkspaceRepository } from './secondary/fs/FSWorkspaceRepository';
import { ProcessAgentRunner } from './secondary/agent/ProcessAgentRunner';
import { FSAgentRepository } from './secondary/fs/FSAgentRepository';
import { FSMcpConfig } from './secondary/fs/FSMcpConfig';
import { FSSpecAgentRepository } from './secondary/fs/FSSpecAgentRepository';
import { FSDevOpsAgentRepository } from './secondary/fs/FSDevOpsAgentRepository';
import { FSExtensionRepository } from './secondary/fs/FSExtensionRepository';
import { FSExecutionHistory } from './secondary/fs/FSExecutionHistory';
import { ProcessSpecifyRunner } from './secondary/cli/ProcessSpecifyRunner';
import { WorkflowService } from '../domain/services/WorkflowService';
import { FSCredentialStore } from './secondary/fs/FSCredentialStore';
import { createLlmClient } from './secondary/llm';
import { OpenAiTranscriber } from './secondary/llm/OpenAiTranscriber';
import { OfficeDocumentReader } from './secondary/docs/OfficeDocumentReader';
import { ZoomAuth } from './secondary/zoom/ZoomAuth';
import { ZoomMcpMeetingSource } from './secondary/zoom/ZoomMcpMeetingSource';
import { IntegrationsService } from '../domain/services/IntegrationsService';
import { RequirementsService } from '../domain/services/RequirementsService';
import { MeetingImportService } from '../domain/services/MeetingImportService';
import { FeatureCreationService } from '../domain/services/FeatureCreationService';
import { MeetingAgentRunner } from '../domain/services/MeetingAgentRunner';
import { ZOOM_TOKEN_ENV } from '../domain/models/mcp';
import { ProcessPreviewRunner } from './secondary/preview/ProcessPreviewRunner';
import { PreviewService } from '../domain/services/PreviewService';

const workspaceRepo = new FSWorkspaceRepository();
const credentialStore = new FSCredentialStore();
export const zoomAuth = new ZoomAuth(credentialStore);
// Every agent run gets a fresh Zoom access token (when Zoom is connected), so an
// MCP server header like "Bearer ${ZOOM_MEETINGS_MCP_ACCESS_TOKEN}" just works.
// The live agent sessions (to stop them, type into them, close them when a
// card moves on) are shared by the whole server process. In `next dev` this
// module gets reloaded: keep the sessions, but build the runner from the
// current code — caching the runner itself kept running stale code after edits.
const globalForAgents = globalThis as unknown as { speckitAgentSessions?: Map<string, any> };
const agentSessions = globalForAgents.speckitAgentSessions ??= new Map();
const agentRunner = new ProcessAgentRunner(async (): Promise<Record<string, string>> => {
  try {
    return { [ZOOM_TOKEN_ENV]: await zoomAuth.getAccessToken() };
  } catch {
    return {}; // Zoom not connected
  }
}, agentSessions);

export const executionHistory = new FSExecutionHistory();
export const extensionRepository = new FSExtensionRepository();
export const workflowService = new WorkflowService(workspaceRepo, agentRunner, executionHistory, extensionRepository);
export const agentRepository = new FSAgentRepository();
export const mcpConfig = new FSMcpConfig();
export const specAgentRepository = new FSSpecAgentRepository();
export const devopsAgentRepository = new FSDevOpsAgentRepository();
export const specifyCli = new ProcessSpecifyRunner();

// Meeting → requirements (user-provided AI keys + Zoom MCP)
export const integrationsService = new IntegrationsService(credentialStore, createLlmClient);
export const zoomMeetingSource = new ZoomMcpMeetingSource(force => zoomAuth.getAccessToken(force));
// Editing a requirement that already became a feature flags that feature's spec out of date.
export const requirementsService = new RequirementsService(workspaceRepo, async (ws, feature) => {
  await workflowService.markStale(ws, 'specification', feature);
});
// The bundled meetings extension, run by the active agent (the default engine).
export const meetingAgentRunner = new MeetingAgentRunner(agentRepository, mcpConfig, extensionRepository, agentRunner);
export const meetingImportService = new MeetingImportService(
  workspaceRepo,
  requirementsService,
  integrationsService,
  () => zoomMeetingSource,
  executionHistory,
  Date.now,
  meetingAgentRunner,
  new OpenAiTranscriber(),
  new OfficeDocumentReader()
);
export const featureCreationService = new FeatureCreationService(
  workspaceRepo, requirementsService, integrationsService, workflowService, meetingAgentRunner, executionHistory
);

// Live preview: the agent works out how to run the project, this app runs it.
// Like the agent sessions, the running dev servers outlive a module reload; the runner is rebuilt from current code.
const globalForPreview = globalThis as unknown as { speckitPreviewServers?: Map<string, any> };
const previewRunner = new ProcessPreviewRunner(undefined, undefined, globalForPreview.speckitPreviewServers ??= new Map());
export const previewService = new PreviewService(workspaceRepo, previewRunner, agentRunner, agentRepository, executionHistory);
