import { describe, it, expect } from 'vitest';
import { isWorkflowState } from './workflowState';

describe('isWorkflowState', () => {
  it('accepts a workflow state and rejects API error payloads', () => {
    expect(isWorkflowState({ constitutionPhase: { phase: 'constitution', status: 'idle', filePath: null, content: null }, features: [], activeFeatureName: null })).toBe(true);
    expect(isWorkflowState({ error: 'Forbidden host' })).toBe(false);
    expect(isWorkflowState({ constitutionPhase: {}, features: 'x' })).toBe(false);
    expect(isWorkflowState(null)).toBe(false);
    expect(isWorkflowState(undefined)).toBe(false);
  });
});
