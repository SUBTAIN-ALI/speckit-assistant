import { AgentConfig, CostMetadata, UserExpertiseProfile } from '../models/types';
import { Requirement } from '../models/requirements';
import {
  BrowserTestConfig,
  BrowserTestResult,
  BrowserTestStatus,
  ChromeConnectionStatus,
  DEFAULT_BROWSER_TEST_CONFIG,
} from '../models/browserTest';
import { AgentRunnerPort } from '../ports/out/AgentRunnerPort';
import { WorkspaceRepositoryPort } from '../ports/out/WorkspaceRepositoryPort';
import { ExecutionHistoryPort } from '../ports/out/ExecutionHistoryPort';
import {
  buildBrowserTestSystemPrompt,
  buildBrowserTestUserPrompt,
  browserTestReportPath,
} from './browserTestPrompt';

// Chrome extension MCP server configuration for the agent CLI.
// The extension runs a local server that the agent connects to at runtime.
const CHROME_MCP_SERVER_CONFIG = {
  'claude-in-chrome': {
    command: 'npx',
    args: ['-y', '@anthropic/claude-in-chrome-mcp'],
  },
};

// Tools the browser test agent is allowed to use.
const BROWSER_TEST_TOOLS = [
  'Read',
  'Write',
  'Edit',
  'mcp__claude-in-chrome__tabs_context_mcp',
  'mcp__claude-in-chrome__tabs_create_mcp',
  'mcp__claude-in-chrome__tabs_close_mcp',
  'mcp__claude-in-chrome__navigate',
  'mcp__claude-in-chrome__computer',
  'mcp__claude-in-chrome__read_page',
  'mcp__claude-in-chrome__get_page_text',
  'mcp__claude-in-chrome__form_input',
  'mcp__claude-in-chrome__find',
  'mcp__claude-in-chrome__read_console_messages',
  'mcp__claude-in-chrome__javascript_tool',
  'mcp__claude-in-chrome__gif_creator',
];

export class BrowserTestService {
  constructor(
    private workspaceRepo: WorkspaceRepositoryPort,
    private agentRunner: AgentRunnerPort,
    private executionHistory: ExecutionHistoryPort
  ) {}

  async checkChromeConnection(): Promise<ChromeConnectionStatus> {
    // We can't directly call MCP tools from the Node backend.
    // The connectivity check happens client-side or at the start of the agent run.
    // The agent's first action is to call list_connected_browsers — if it fails,
    // the test aborts with a clear message.
    // For the UI, we return 'unknown' and let the agent run determine the real status.
    return 'unknown';
  }

  async runBrowserTest(
    workspacePath: string,
    featureName: string,
    requirements: Requirement[],
    agentConfig: AgentConfig,
    config?: BrowserTestConfig,
    expertiseProfile?: UserExpertiseProfile,
    onData?: (text: string) => void,
    onStatus?: (status: BrowserTestStatus) => void
  ): Promise<BrowserTestResult> {
    const testConfig = { ...DEFAULT_BROWSER_TEST_CONFIG, ...config };
    const serverUrl = testConfig.serverUrl!;
    const started = Date.now();

    const result: BrowserTestResult = {
      featureName,
      status: 'checking-chrome',
      startedAt: started,
      serverUrl,
      criteria: [],
    };

    onStatus?.('checking-chrome');

    const record = await this.executionHistory.start(workspacePath, {
      kind: 'browser-test',
      feature: featureName,
      label: `Browser test: ${featureName}`,
    });
    const log = (text: string) => {
      this.executionHistory.appendLog(workspacePath, record.id, text);
      onData?.(text);
    };

    try {
      onStatus?.('running');
      log(`\r\n\x1b[36m=== Browser Test: ${featureName} ===\x1b[0m\r\n`);
      log(`Server URL: ${serverUrl}\r\n`);

      const systemPrompt = buildBrowserTestSystemPrompt();
      const userPrompt = buildBrowserTestUserPrompt({
        featureName,
        serverUrl,
        requirements,
        expertiseProfile,
      });

      const fullContext = [
        systemPrompt,
        '',
        'IMPORTANT: Before testing, first call mcp__claude-in-chrome__list_connected_browsers to verify Chrome is connected. If no browser is connected, write a report saying "Chrome extension not connected" and exit.',
        '',
        `After completing all tests, write the report to ${browserTestReportPath(featureName)}.`,
      ].join('\n');

      let cost: CostMetadata | undefined;
      const exitCode = await this.agentRunner.runCommand(
        workspacePath,
        {
          key: `browser-test-${featureName}`,
          command: '',
          context: fullContext,
          args: userPrompt,
          restricted: {
            allowedTools: BROWSER_TEST_TOOLS,
            mcpServers: CHROME_MCP_SERVER_CONFIG,
          },
        },
        agentConfig,
        log,
        c => { cost = c; }
      );

      // Read the report if the agent wrote one
      const reportPath = browserTestReportPath(featureName);
      let reportContent = '';
      try {
        reportContent = await this.workspaceRepo.readFile(workspacePath, reportPath);
      } catch { /* no report written */ }

      const chromeNotConnected = reportContent.toLowerCase().includes('chrome extension not connected')
        || reportContent.toLowerCase().includes('no browser is connected');

      if (chromeNotConnected) {
        result.status = 'chrome-not-connected';
        result.summary = 'Chrome extension is not connected. Install and connect it to run browser tests.';
      } else if (exitCode !== 0 && !reportContent) {
        result.status = 'failed';
        result.summary = `Agent exited with code ${exitCode} without writing a test report.`;
      } else {
        result.status = 'completed';
        result.reportPath = reportPath;
        result.criteria = parseReportCriteria(reportContent);
        result.summary = parseReportSummary(reportContent);
      }

      result.completedAt = Date.now();

      await this.executionHistory.finish(workspacePath, record.id, {
        status: result.status === 'completed' ? 'passed' : 'failed',
        exitCode,
        cost,
      });

      return result;
    } catch (err) {
      result.status = 'failed';
      result.completedAt = Date.now();
      result.summary = err instanceof Error ? err.message : String(err);

      await this.executionHistory.finish(workspacePath, record.id, {
        status: 'failed',
        exitCode: 1,
      });

      return result;
    }
  }
}

export function parseReportCriteria(report: string): BrowserTestResult['criteria'] {
  const criteria: BrowserTestResult['criteria'] = [];
  // Match sections like "### REQ-001: criterion text" followed by "**Status:** PASS|FAIL|SKIPPED"
  const sectionRe = /###\s+(REQ-\d+):\s*(.+)\n[\s\S]*?\*\*Status:\*\*\s*(PASS|FAIL|SKIPPED)/gi;
  let match;
  while ((match = sectionRe.exec(report)) !== null) {
    const [, reqId, criterion, status] = match;
    // Extract reason from "**Evidence:**" or "**Steps taken:**"
    const afterStatus = report.slice(match.index + match[0].length, match.index + match[0].length + 500);
    const evidenceMatch = /\*\*Evidence:\*\*\s*(.+)/i.exec(afterStatus);
    const statusMap: Record<string, 'passed' | 'failed' | 'skipped'> = {
      pass: 'passed', fail: 'failed', skipped: 'skipped',
      passed: 'passed', failed: 'failed',
    };
    criteria.push({
      requirementId: reqId,
      criterion: criterion.trim(),
      status: statusMap[status.toLowerCase()] ?? 'skipped',
      reason: evidenceMatch?.[1]?.trim() || '',
    });
  }
  return criteria;
}

export function parseReportSummary(report: string): string {
  const summaryMatch = /## Summary\n+([\s\S]+?)(?:\n##|\n*$)/i.exec(report);
  return summaryMatch?.[1]?.trim() || '';
}
