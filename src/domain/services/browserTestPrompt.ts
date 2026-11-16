import { Requirement } from '../models/requirements';
import { UserExpertiseProfile } from '../models/types';

export function buildBrowserTestSystemPrompt(): string {
  return `You are a QA tester performing manual acceptance testing in a live browser. You have access to Chrome browser automation tools (MCP tools prefixed with mcp__claude-in-chrome__).

Your job:
1. Navigate to the running application.
2. For each acceptance criterion provided, attempt to verify it in the browser.
3. Take a screenshot after each test step as evidence.
4. Report a clear PASS or FAIL for each criterion with reasoning.

Rules:
- Test what the criterion says, nothing more. Don't invent extra tests.
- If a criterion can't be tested in the browser (e.g. "database stores encrypted passwords"), mark it SKIPPED with a reason.
- If a page doesn't load or an element is missing, that's a FAIL — don't retry more than twice.
- Be methodical: navigate to the right page, perform the action, verify the expected outcome.
- If you need to create test data (fill a form, create an account), use obviously fake data.
- After testing all criteria, write a summary report.

Output format — after testing all criteria, write a Markdown report with this structure:

# Browser Test Report: {feature name}

**Tested at:** {timestamp}
**Server:** {url}
**Result:** {X passed, Y failed, Z skipped} of {total}

## Results

### {REQ-ID}: {criterion text}
**Status:** PASS | FAIL | SKIPPED
**Steps taken:** {what you did}
**Evidence:** {what you observed}
**Screenshot:** {path if taken}

(repeat for each criterion)

## Summary
{1-2 sentences: overall assessment and any critical failures}`;
}

export function buildBrowserTestUserPrompt(opts: {
  featureName: string;
  serverUrl: string;
  requirements: Requirement[];
  expertiseProfile?: UserExpertiseProfile;
}): string {
  const { featureName, serverUrl, requirements, expertiseProfile } = opts;

  const criteria: string[] = [];
  for (const req of requirements) {
    if (req.status !== 'accepted') continue;
    for (const ac of req.acceptanceCriteria) {
      criteria.push(`- [${req.id}] ${ac}`);
    }
  }

  if (criteria.length === 0) {
    return `Feature "${featureName}" has no accepted requirements with acceptance criteria. Nothing to test.`;
  }

  const parts = [
    `Test the feature "${featureName}" in the browser.`,
    '',
    `**Application URL:** ${serverUrl}`,
    '',
    '## Acceptance criteria to verify:',
    '',
    ...criteria,
    '',
    `There are ${criteria.length} criteria to test. Work through each one in order.`,
    '',
    'Start by navigating to the application URL and understanding the current state of the UI.',
    `Write the final report to specs/${featureName}/browser-test-report.md.`,
  ];

  if (expertiseProfile && expertiseProfile.mode !== 'power-user') {
    parts.push('');
    parts.push(reportStyleAddon(expertiseProfile.mode));
  }

  return parts.join('\n');
}

function reportStyleAddon(mode: string): string {
  if (mode === 'tech-shield' || mode === 'full-guidance') {
    return `When writing the test report, use plain language. Instead of "HTTP 404 returned", write "The page showed a 'not found' error." Instead of "DOM element not present", write "The button was missing from the page." The person reading this report is not a developer.`;
  }
  if (mode === 'domain-transfer') {
    return `When a test involves a domain-specific workflow or term, briefly note what the business rule is and why the criterion matters.`;
  }
  return '';
}

export function browserTestReportPath(featureName: string): string {
  return `specs/${featureName}/browser-test-report.md`;
}
