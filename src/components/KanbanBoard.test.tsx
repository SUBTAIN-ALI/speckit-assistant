// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { KanbanBoard, PROCEED_ANSWER } from './KanbanBoard';
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
  const handlers = { onRerunGate: vi.fn(), onStopPhase: vi.fn(), onRunPhase: vi.fn(), onOpenReview: vi.fn(), onFinishPhase: vi.fn(), onPreview: vi.fn(), onAnswerPhase: vi.fn(), onQuickBuild: vi.fn() };
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

  it('tells a reviewer that is not installed apart from one that failed', () => {
    const h = renderBoard(stateWith({
      personas: [
        { id: 'qa', status: 'unavailable', reportPath: null, note: 'QA can\'t run: /speckit.personas.qa isn\'t installed in this workspace.' },
        { id: 'code-review', status: 'idle', reportPath: 'r/cr.md' },
      ],
    }));
    const badge = screen.getByText(/BLOCKED · QA NOT INSTALLED/);
    expect(badge.getAttribute('title')).toContain('/speckit.personas.qa');
    expect(screen.queryByText('Stop')).toBeNull();
    fireEvent.click(screen.getByText('Re-run review'));
    expect(h.onRerunGate).toHaveBeenCalledWith('005-scheduled-orders');
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

describe('KanbanBoard interactive Clarify', () => {
  it('offers Finish while Clarify is waiting at its prompt', () => {
    const state: WorkflowState = {
      constitutionPhase: { phase: 'constitution', status: 'approved', filePath: null, content: null },
      activeFeatureName: '001-signup',
      features: [{
        name: '001-signup',
        phases: [
          approved('specification'),
          { phase: 'clarification', status: 'running', filePath: null, content: null },
          ...(['planning', 'checklist', 'analyze', 'tasks', 'taskstoissues', 'implementation'] as const)
            .map(p => ({ phase: p, status: 'idle' as const, filePath: null, content: null })),
        ],
      }],
    };
    const h = renderBoard(state);
    expect(screen.getByText('Stop')).toBeTruthy();
    fireEvent.click(screen.getByText('Finish'));
    expect(h.onFinishPhase).toHaveBeenCalledWith('clarification', '001-signup');
  });
});

describe('KanbanBoard preview', () => {
  it('offers Preview once implementation is ready for review', () => {
    const h = renderBoard(stateWith({ status: 'awaiting_review' }));
    fireEvent.click(screen.getByText('Preview'));
    expect(h.onPreview).toHaveBeenCalledWith('005-scheduled-orders');
  });

  it('not while implementation is still running', () => {
    renderBoard(stateWith({ status: 'running' }));
    expect(screen.queryByText('Preview')).toBeNull();
  });
});

describe('KanbanBoard: a run that needs the user', () => {
  it('shows the question and answers it', () => {
    const h = renderBoard(stateWith({
      status: 'idle',
      attention: { message: 'Implement finished without completing any tasks (0 of 70 done).', question: 'Do you want to proceed with implementation anyway? (yes/no)' },
    }));
    expect(screen.getByText(/0 of 70 done/)).toBeTruthy();
    expect(screen.getByText(/proceed with implementation anyway/)).toBeTruthy();
    fireEvent.click(screen.getByText('Yes, proceed'));
    expect(h.onAnswerPhase).toHaveBeenCalledWith('implementation', '005-scheduled-orders', PROCEED_ANSWER);

    fireEvent.change(screen.getByLabelText('Your answer to the agent'), { target: { value: 'No, run /speckit-clarify first' } });
    fireEvent.click(screen.getByText('Send'));
    expect(h.onAnswerPhase).toHaveBeenLastCalledWith('implementation', '005-scheduled-orders', 'No, run /speckit-clarify first');
  });
});

describe('KanbanBoard quick build', () => {
  const specInReview = (): WorkflowState => ({
    constitutionPhase: { phase: 'constitution', status: 'approved', filePath: null, content: null },
    activeFeatureName: '002-login',
    features: [{
      name: '002-login',
      phases: [
        { phase: 'specification', status: 'awaiting_review', filePath: '/s.md', content: '' },
        ...(['clarification', 'planning', 'checklist', 'analyze', 'tasks', 'taskstoissues', 'implementation'] as const)
          .map(p => ({ phase: p, status: 'idle' as const, filePath: null, content: null })),
      ],
    }],
  });

  it('offers Quick build on a Specification card in review', () => {
    const h = renderBoard(specInReview());
    fireEvent.click(screen.getByText('Quick build'));
    expect(h.onQuickBuild).toHaveBeenCalledWith('002-login');
    expect(screen.getByText('Approve')).toBeTruthy(); // the normal flow stays
  });

  it('puts a quick-built card in Implementation with its skipped phases', () => {
    const st = specInReview();
    st.features[0].phases.forEach(p => { p.status = p.phase === 'specification' ? 'approved' : p.phase === 'implementation' ? 'running' : 'skipped'; });
    st.features[0].phases.at(-1)!.quickBuild = true;
    renderBoard(st);
    expect(screen.getByText(/QUICK BUILD/)).toBeTruthy();
    expect(screen.queryByText('Quick build')).toBeNull(); // only on Specification cards
  });
});

