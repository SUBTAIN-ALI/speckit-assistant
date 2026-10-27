// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MeetingImportModal } from './MeetingImportModal';

const base = { isOpen: true, zoomConnected: false, onClose: vi.fn(), onImported: vi.fn(), onOpenSettings: vi.fn() };

describe('MeetingImportModal readiness message', () => {
  it('shows the agent setup problem and its fix instead of asking for an API key', () => {
    const fix = vi.fn();
    render(<MeetingImportModal {...base} llmLabel={null}
      blocker={{ message: 'Install “Meeting Requirements” from the Extensions section.', action: { label: 'Open Extensions', onClick: fix } }} />);
    expect(screen.getByText(/Install “Meeting Requirements”/)).toBeTruthy();
    expect(screen.queryByText(/Add an AI provider key/)).toBeNull();
    fireEvent.click(screen.getByText('Open Extensions'));
    expect(fix).toHaveBeenCalled();
  });

  it('shows a message without an action (e.g. Spec Kit not set up)', () => {
    render(<MeetingImportModal {...base} llmLabel={null} blocker={{ message: 'This project has no Spec Kit yet.' }} />);
    expect(screen.getByText('This project has no Spec Kit yet.')).toBeTruthy();
  });

  it('falls back to the API-key message in direct mode', () => {
    render(<MeetingImportModal {...base} llmLabel={null} />);
    expect(screen.getByText(/Add an AI provider key first/)).toBeTruthy();
  });

  it('shows no warning when ready', () => {
    render(<MeetingImportModal {...base} llmLabel="Claude (Default) (agent)" blocker={null} />);
    expect(screen.queryByText(/Add an AI provider key/)).toBeNull();
    expect(screen.getByText(/using Claude \(Default\) \(agent\)/)).toBeTruthy();
  });
});
