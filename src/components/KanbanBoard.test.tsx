// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { KanbanBoard } from './KanbanBoard';
import { PhaseState, WorkflowState } from '../domain/models/types';

const approved = (phase: PhaseState['phase']): PhaseState => ({ phase, status: 'approved', filePath: null, content: null });

const stateWith = (impl: Partial<PhaseState>): WorkflowState => ({
  constitutionPhase: { phase: 'constitution', status: 'approved', filePath: null, content: null },
  activeFeatureName: '005-scheduled-orders',
  features: [{
    name: '005-scheduled-orders',
    phases: [
      ...(['specification', 'clarification', 'planning', 'checklist', 'analyze', 'tasks', 'taskstoissues'] as const).map(approved),
      { phase: 'implementation', status: 'running', filePath: null, content: null, ...impl },
    ],
  }],
});

const renderBoard = (state: WorkflowState) => {
  const handlers = { onRerunGate: vi.fn(), onStopPhase: vi.fn(), onRunPhase: vi.fn(), onOpenReview: vi.fn() };
  render(
    <KanbanBoard
      state={state}
      onApprovePhase={vi.fn()}
      onDiscardPhase={vi.fn()}
      onSelectFeature={vi.fn()}
      onDeleteFeature={vi.fn()}
      onSelectPhaseFile={vi.fn()}
      {...handlers}
    />
  );
  return handlers;
};

describe('KanbanBoard review gate', () => {
  it('shows a gate stopped by a failing reviewer as blocked, with a way forward', () => {
    const h = renderBoard(stateWith({
      personas: [
        { id: 'qa', status: 'failed', reportPath: 'r/qa.md' },
        { id: 'code-review', status: 'idle', reportPath: 'r/cr.md' },
      ],
    }));
    expect(screen.getByText(/BLOCKED · QA/)).toBeTruthy();
    expect(screen.queryByText('RUNNING')).toBeNull();
    expect(screen.queryByText('Stop')).toBeNull();

    fireEvent.click(screen.getByText('Re-run review'));
    expect(h.onRerunGate).toHaveBeenCalledWith('005-scheduled-orders');
    fireEvent.click(screen.getByText('Run'));
    expect(h.onRunPhase).toHaveBeenCalledWith('implementation', '005-scheduled-orders');
    expect((screen.getByText('Review').closest('button') as HTMLButtonElement).disabled).toBe(false);
  });

  it('still shows running, with Stop, while a reviewer is working', () => {
    renderBoard(stateWith({
      personas: [
        { id: 'qa', status: 'passed', reportPath: 'r/qa.md' },
        { id: 'code-review', status: 'running', reportPath: 'r/cr.md' },
      ],
    }));
    expect(screen.queryByText(/BLOCKED/)).toBeNull();
    expect(screen.getByText('RUNNING')).toBeTruthy();
    expect(screen.getByText('Stop')).toBeTruthy();
    expect(screen.queryByText('Re-run review')).toBeNull();
  });
});
