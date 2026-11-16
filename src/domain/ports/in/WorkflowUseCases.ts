import { WorkflowState, WorkflowPhase, AgentConfig, PersonaConfig, PersonaId, UserExpertiseProfile } from '../../models/types';
import { BrowserTestConfig, BrowserTestResult, BrowserTestStatus } from '../../models/browserTest';

export interface WorkflowUseCases {
  getWorkflowState(workspacePath: string): Promise<WorkflowState>;
  createFeature(workspacePath: string, name: string): Promise<WorkflowState>;
  deleteFeature(workspacePath: string, name: string): Promise<WorkflowState>;
  setActiveFeature(workspacePath: string, name: string): Promise<WorkflowState>;
  runPhase(
    workspacePath: string,
    phase: WorkflowPhase,
    featureName: string | null,
    agentConfig: AgentConfig,
    userPrompt?: string,
    onData?: (text: string) => void,
    personas?: PersonaConfig[]
  ): Promise<WorkflowState>;
  runImplementationGate(
    workspacePath: string,
    featureName: string,
    agentConfig: AgentConfig,
    personas: PersonaConfig[],
    onData?: (text: string) => void
  ): Promise<WorkflowState>;
  runFix(
    workspacePath: string,
    featureName: string,
    failedPersonaId: PersonaId,
    fixInstruction: string,
    agentConfig: AgentConfig,
    personas: PersonaConfig[],
    onData?: (text: string) => void
  ): Promise<WorkflowState>;
  approvePhase(workspacePath: string, phase: WorkflowPhase, featureName: string | null): Promise<WorkflowState>;
  markStale(workspacePath: string, phase: WorkflowPhase, featureName: string): Promise<WorkflowState>;
  discardPhase(workspacePath: string, phase: WorkflowPhase, featureName: string | null): Promise<WorkflowState>;
  toggleTask(workspacePath: string, featureName: string, lineIndex: number, checked: boolean): Promise<WorkflowState>;
  readFile(workspacePath: string, filePath: string): Promise<string>;
  writeFile(workspacePath: string, filePath: string, content: string): Promise<WorkflowState>;
  setExpertiseProfile(workspacePath: string, profile: UserExpertiseProfile): Promise<WorkflowState>;
  runBrowserTest(
    workspacePath: string,
    featureName: string,
    agentConfig: AgentConfig,
    config?: BrowserTestConfig,
    onData?: (text: string) => void,
    onStatus?: (status: BrowserTestStatus) => void
  ): Promise<BrowserTestResult>;
  writeStdin(phase: WorkflowPhase, featureName: string | null, text: string, personaId?: PersonaId): Promise<boolean>;
  resize(phase: WorkflowPhase, featureName: string | null, cols: number, rows: number, personaId?: PersonaId): Promise<boolean>;
  stop(phase: WorkflowPhase, featureName: string | null, personaId?: PersonaId): Promise<boolean>;
}
