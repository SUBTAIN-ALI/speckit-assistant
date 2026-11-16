export type ChromeConnectionStatus = 'connected' | 'not-connected' | 'unknown';

export type BrowserTestStatus =
  | 'idle'
  | 'checking-chrome'
  | 'starting-server'
  | 'running'
  | 'completed'
  | 'failed'
  | 'chrome-not-connected';

export type CriterionResult = {
  criterion: string;
  requirementId: string;
  status: 'passed' | 'failed' | 'skipped';
  reason: string;
  screenshotPath?: string;
};

export type BrowserTestResult = {
  featureName: string;
  status: BrowserTestStatus;
  startedAt: number;
  completedAt?: number;
  serverUrl?: string;
  criteria: CriterionResult[];
  summary?: string;
  reportPath?: string;
};

export type BrowserTestConfig = {
  serverCommand?: string; // e.g. "npm run dev"
  serverUrl?: string;     // e.g. "http://localhost:3000"
  serverReadyTimeout?: number; // ms to wait for server, default 30000
};

export const DEFAULT_BROWSER_TEST_CONFIG: BrowserTestConfig = {
  serverUrl: 'http://localhost:3000',
  serverReadyTimeout: 30_000,
};
