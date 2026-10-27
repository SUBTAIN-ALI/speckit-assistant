import { PreviewConfig, PreviewStatus } from '../../models/preview';

// Runs a project's dev server for the preview (one per project) and reports
// where it answers. start() returns at once; status() follows the server.
export interface PreviewRunnerPort {
  start(workspacePath: string, config: PreviewConfig): Promise<PreviewStatus>;
  stop(workspacePath: string): Promise<void>;
  status(workspacePath: string): PreviewStatus;
  stopAll(): Promise<void>;
}
