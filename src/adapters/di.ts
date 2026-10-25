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
import { ZoomAuth } from './secondary/zoom/ZoomAuth';
import { ZoomMcpMeetingSource } from './secondary/zoom/ZoomMcpMeetingSource';
import { IntegrationsService } from '../domain/services/IntegrationsService';
import { RequirementsService } from '../domain/services/RequirementsService';
import { MeetingImportService } from '../domain/services/MeetingImportService';
import { FeatureCreationService } from '../domain/services/FeatureCreationService';

const workspaceRepo = new FSWorkspaceRepository();
const agentRunner = new ProcessAgentRunner();

export const executionHistory = new FSExecutionHistory();
export const workflowService = new WorkflowService(workspaceRepo, agentRunner, executionHistory);
export const agentRepository = new FSAgentRepository();
export const mcpConfig = new FSMcpConfig();
export const specAgentRepository = new FSSpecAgentRepository();
export const devopsAgentRepository = new FSDevOpsAgentRepository();
export const extensionRepository = new FSExtensionRepository();
export const specifyCli = new ProcessSpecifyRunner();

// Meeting → requirements (user-provided AI keys + Zoom MCP)
const credentialStore = new FSCredentialStore();
export const integrationsService = new IntegrationsService(credentialStore, createLlmClient);
export const zoomAuth = new ZoomAuth(credentialStore);
export const zoomMeetingSource = new ZoomMcpMeetingSource(force => zoomAuth.getAccessToken(force));
// Editing a requirement that already became a feature flags that feature's spec out of date.
export const requirementsService = new RequirementsService(workspaceRepo, async (ws, feature) => {
  await workflowService.markStale(ws, 'specification', feature);
});
export const meetingImportService = new MeetingImportService(
  workspaceRepo,
  requirementsService,
  integrationsService,
  () => zoomMeetingSource,
  executionHistory
);
export const featureCreationService = new FeatureCreationService(workspaceRepo, requirementsService, integrationsService, workflowService);
