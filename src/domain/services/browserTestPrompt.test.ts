import { describe, it, expect } from 'vitest';
import {
  buildBrowserTestSystemPrompt,
  buildBrowserTestUserPrompt,
  browserTestReportPath,
} from './browserTestPrompt';
import { Requirement } from '../models/requirements';

const makeReq = (id: string, criteria: string[], status: 'accepted' | 'rejected' = 'accepted'): Requirement => ({
  id,
  title: `Requirement ${id}`,
  description: '',
  acceptanceCriteria: criteria,
  status,
  priority: 'medium',
});

describe('buildBrowserTestSystemPrompt', () => {
  it('returns a non-empty string with core instructions', () => {
    const prompt = buildBrowserTestSystemPrompt();
    expect(prompt).toContain('QA tester');
    expect(prompt).toContain('PASS');
    expect(prompt).toContain('FAIL');
    expect(prompt).toContain('SKIPPED');
    expect(prompt).toContain('mcp__claude-in-chrome__');
  });

  it('includes the expected report format', () => {
    const prompt = buildBrowserTestSystemPrompt();
    expect(prompt).toContain('# Browser Test Report');
    expect(prompt).toContain('**Status:**');
    expect(prompt).toContain('## Summary');
  });
});

describe('buildBrowserTestUserPrompt', () => {
  it('lists accepted criteria', () => {
    const reqs = [
      makeReq('REQ-001', ['User can log in', 'Error shown on bad password']),
      makeReq('REQ-002', ['Dashboard loads within 2 seconds']),
    ];
    const prompt = buildBrowserTestUserPrompt({
      featureName: 'auth',
      serverUrl: 'http://localhost:3000',
      requirements: reqs,
    });
    expect(prompt).toContain('auth');
    expect(prompt).toContain('http://localhost:3000');
    expect(prompt).toContain('[REQ-001] User can log in');
    expect(prompt).toContain('[REQ-001] Error shown on bad password');
    expect(prompt).toContain('[REQ-002] Dashboard loads within 2 seconds');
    expect(prompt).toContain('3 criteria to test');
  });

  it('skips rejected requirements', () => {
    const reqs = [
      makeReq('REQ-001', ['Visible criterion'], 'accepted'),
      makeReq('REQ-002', ['Hidden criterion'], 'rejected'),
    ];
    const prompt = buildBrowserTestUserPrompt({
      featureName: 'feat',
      serverUrl: 'http://localhost:3000',
      requirements: reqs,
    });
    expect(prompt).toContain('[REQ-001]');
    expect(prompt).not.toContain('[REQ-002]');
    expect(prompt).toContain('1 criteria to test');
  });

  it('returns no-test message when no accepted criteria exist', () => {
    const prompt = buildBrowserTestUserPrompt({
      featureName: 'empty',
      serverUrl: 'http://localhost:3000',
      requirements: [],
    });
    expect(prompt).toContain('no accepted requirements');
    expect(prompt).toContain('Nothing to test');
  });

  it('appends plain language addon for full-guidance mode', () => {
    const reqs = [makeReq('REQ-001', ['User sees welcome page'])];
    const prompt = buildBrowserTestUserPrompt({
      featureName: 'onboard',
      serverUrl: 'http://localhost:3000',
      requirements: reqs,
      expertiseProfile: {
        technicalLevel: 'non-technical',
        domainKnowledge: 'no-domain',
        mode: 'full-guidance',
      },
    });
    expect(prompt).toContain('plain language');
  });

  it('appends domain-transfer addon', () => {
    const reqs = [makeReq('REQ-001', ['User sees welcome page'])];
    const prompt = buildBrowserTestUserPrompt({
      featureName: 'onboard',
      serverUrl: 'http://localhost:3000',
      requirements: reqs,
      expertiseProfile: {
        technicalLevel: 'technical',
        domainKnowledge: 'no-domain',
        mode: 'domain-transfer',
      },
    });
    expect(prompt).toContain('domain-specific');
  });

  it('does not append addon for power-user mode', () => {
    const reqs = [makeReq('REQ-001', ['User sees welcome page'])];
    const prompt = buildBrowserTestUserPrompt({
      featureName: 'onboard',
      serverUrl: 'http://localhost:3000',
      requirements: reqs,
      expertiseProfile: {
        technicalLevel: 'technical',
        domainKnowledge: 'has-domain',
        mode: 'power-user',
      },
    });
    expect(prompt).not.toContain('plain language');
    expect(prompt).not.toContain('domain-specific');
  });
});

describe('browserTestReportPath', () => {
  it('returns the correct path', () => {
    expect(browserTestReportPath('login')).toBe('specs/login/browser-test-report.md');
  });
});
