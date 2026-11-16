import { describe, it, expect } from 'vitest';
import { parseReportCriteria, parseReportSummary } from './BrowserTestService';

const SAMPLE_REPORT = `# Browser Test Report: login

**Tested at:** 2026-11-13T10:00:00Z
**Server:** http://localhost:3000
**Result:** 2 passed, 1 failed, 0 skipped of 3

## Results

### REQ-001: User can log in with valid credentials
**Status:** PASS
**Steps taken:** Navigated to /login, entered test@example.com and password, clicked Submit
**Evidence:** Redirected to /dashboard with welcome message

### REQ-002: Error shown on invalid password
**Status:** FAIL
**Steps taken:** Navigated to /login, entered wrong password, clicked Submit
**Evidence:** No error message displayed, page just reloaded

### REQ-003: Session persists after refresh
**Status:** PASS
**Steps taken:** Logged in, refreshed the page
**Evidence:** Still on dashboard with user info visible

## Summary
Two of three acceptance criteria passed. The invalid password error message is missing — the login form silently reloads instead of showing an error.`;

describe('parseReportCriteria', () => {
  it('extracts all criteria with correct statuses', () => {
    const criteria = parseReportCriteria(SAMPLE_REPORT);
    expect(criteria).toHaveLength(3);
    expect(criteria[0]).toEqual({
      requirementId: 'REQ-001',
      criterion: 'User can log in with valid credentials',
      status: 'passed',
      reason: 'Redirected to /dashboard with welcome message',
    });
    expect(criteria[1]).toEqual({
      requirementId: 'REQ-002',
      criterion: 'Error shown on invalid password',
      status: 'failed',
      reason: 'No error message displayed, page just reloaded',
    });
    expect(criteria[2]).toEqual({
      requirementId: 'REQ-003',
      criterion: 'Session persists after refresh',
      status: 'passed',
      reason: 'Still on dashboard with user info visible',
    });
  });

  it('returns empty array for empty report', () => {
    expect(parseReportCriteria('')).toEqual([]);
  });

  it('returns empty array for report without criteria sections', () => {
    expect(parseReportCriteria('# Browser Test Report\n\nNo tests run.')).toEqual([]);
  });

  it('handles SKIPPED status', () => {
    const report = `### REQ-005: Database stores encrypted passwords
**Status:** SKIPPED
**Steps taken:** N/A
**Evidence:** Cannot verify database state from browser`;
    const criteria = parseReportCriteria(report);
    expect(criteria).toHaveLength(1);
    expect(criteria[0].status).toBe('skipped');
  });
});

describe('parseReportSummary', () => {
  it('extracts the summary section', () => {
    const summary = parseReportSummary(SAMPLE_REPORT);
    expect(summary).toContain('Two of three acceptance criteria passed');
    expect(summary).toContain('invalid password error message is missing');
  });

  it('returns empty string for report without summary', () => {
    expect(parseReportSummary('# Report\n\nSome content')).toBe('');
  });

  it('returns empty string for empty input', () => {
    expect(parseReportSummary('')).toBe('');
  });
});
