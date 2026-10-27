import { WorkflowState } from '../../models/types';

export interface WorkspaceRepositoryPort {
  getWorkflowState(workspacePath: string): Promise<WorkflowState>;
  saveWorkflowState(workspacePath: string, state: WorkflowState): Promise<void>;
  toggleTask(workspacePath: string, featureName: string, lineIndex: number, checked: boolean): Promise<WorkflowState>;
  // Ticks/unticks the checkbox on one line of a Markdown file in the workspace
  // (absolute or workspace-relative path). Throws if that line isn't a checkbox.
  toggleCheckbox(workspacePath: string, filePath: string, lineIndex: number, checked: boolean): Promise<void>;
  createFeature(workspacePath: string, name: string): Promise<WorkflowState>;
  deleteFeature(workspacePath: string, name: string): Promise<WorkflowState>;
  readFile(workspacePath: string, filePath: string): Promise<string>;
  writeFile(workspacePath: string, filePath: string, content: string): Promise<void>;
  // Names of the subdirectories of a workspace directory ([] when it doesn't exist).
  listDirectories(workspacePath: string, dirPath: string): Promise<string[]>;
  // Recursively deletes a workspace directory (no-op when it doesn't exist).
  deleteDirectory(workspacePath: string, dirPath: string): Promise<void>;
}
