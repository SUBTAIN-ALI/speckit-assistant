// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CreateFeaturesModal } from './CreateFeaturesModal';
import { RequirementsDoc } from '../domain/models/requirements';

const DOC: RequirementsDoc = {
  meta: { nextId: 5, title: 'Weekly sync' },
  requirements: [
    { id: 'REQ-001', title: 'Reset password', type: 'functional', priority: 'must', status: 'accepted', description: '', acceptanceCriteria: [] },
    { id: 'REQ-002', title: 'CSV export', type: 'functional', priority: 'should', status: 'accepted', description: '', acceptanceCriteria: [] },
    { id: 'REQ-003', title: 'Dark mode', type: 'functional', priority: 'could', status: 'draft', description: '', acceptanceCriteria: [] },
    { id: 'REQ-004', title: 'Old thing', type: 'functional', priority: 'must', status: 'accepted', description: '', acceptanceCriteria: [], feature: '001-old' },
  ],
};

const sse = (events: Array<[string, unknown]>) =>
  new Response(events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });

describe('CreateFeaturesModal', () => {
  const realFetch = global.fetch;
  let bodies: Array<{ url: string; body: any }>;
  beforeEach(() => {
    bodies = [];
    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      bodies.push({ url, body });
      if (url === '/api/requirements/grouping') {
        return new Response(JSON.stringify({
          groups: [
            { name: 'password-reset', title: 'Password reset', summary: 'Reset flow', requirementIds: ['REQ-001'] },
            { name: 'csv-export', title: 'CSV export', requirementIds: ['REQ-002'] },
          ],
          unassigned: [],
        }));
      }
      return sse([
        ['start', { index: 0, total: 1, feature: '002-password-reset', title: 'Password reset' }],
        ['log', { feature: '002-password-reset', text: '\u001b[32mWriting spec\u001b[0m\n' }],
        ['done', { feature: '002-password-reset', ok: true, message: 'spec.md is ready for review in 002-password-reset.' }],
        ['complete', { created: ['002-password-reset'], failed: [], state: { features: [] } }],
      ]);
    }) as unknown as typeof fetch;
  });
  afterEach(() => { global.fetch = realFetch; });

  const renderModal = (props: Partial<React.ComponentProps<typeof CreateFeaturesModal>> = {}) => {
    const onFinished = vi.fn();
    const onOpenFeature = vi.fn();
    render(<CreateFeaturesModal isOpen setId="s1" doc={DOC} agentConfig={{ agentType: 'openai' }} agentLabel="Codex" llmLabel="OpenAI · gpt-4.1-mini"
      onClose={() => {}} onFinished={onFinished} onOpenFeature={onOpenFeature} {...props} />);
    return { onFinished, onOpenFeature };
  };

  it('preselects accepted, unlinked requirements and hides linked ones', () => {
    renderModal();
    expect(screen.getByText('Requirements to build (2 selected)')).toBeInTheDocument();
    expect(screen.queryByText('Old thing')).not.toBeInTheDocument();
    expect(screen.getByText('Dark mode')).toBeInTheDocument();
  });

  it('runs the AI-suggested flow end to end', async () => {
    const { onFinished, onOpenFeature } = renderModal();
    fireEvent.click(screen.getByText('Next'));
    await screen.findByDisplayValue('Password reset');
    expect(bodies[0]).toEqual({ url: '/api/requirements/grouping', body: { set: 's1', ids: ['REQ-001', 'REQ-002'] } });

    // Move CSV export into the first feature, then remove the now-empty second one.
    fireEvent.change(screen.getByLabelText('Move REQ-002'), { target: { value: '0' } });
    fireEvent.click(screen.getByLabelText('Remove feature 2'));
    fireEvent.change(screen.getByLabelText('Feature 1 title'), { target: { value: 'Account & export' } });
    fireEvent.click(screen.getByText('Create 1 feature'));

    await screen.findByText('Review spec →');
    const create = bodies.find(b => b.url === '/api/requirements/features')!;
    expect(create.body).toEqual({
      set: 's1',
      groups: [{ name: 'password-reset', title: 'Account & export', summary: 'Reset flow', requirementIds: ['REQ-001', 'REQ-002'] }],
      agentConfig: { agentType: 'openai' },
    });
    expect(screen.getByText(/Writing spec/).textContent).not.toContain('\u001b');
    await waitFor(() => expect(onFinished).toHaveBeenCalledWith({ features: [] }));
    fireEvent.click(screen.getByText('Review spec →'));
    expect(onOpenFeature).toHaveBeenCalledWith('002-password-reset');
  });

  it('puts everything in one feature without calling the AI', async () => {
    renderModal();
    fireEvent.click(screen.getByRole('radio', { name: /One feature for all/ }));
    fireEvent.click(screen.getByText('Next'));
    expect(await screen.findByDisplayValue('Weekly sync')).toBeInTheDocument();
    expect(bodies).toHaveLength(0);
    expect(screen.getByText('Create 1 feature')).toBeEnabled();
  });

  it('explains Claude’s one-time bypass-permissions prompt while it waits', async () => {
    global.fetch = vi.fn(async () => {
      // Start + a log that looks like Claude's confirmation screen; the stream stays open.
      const enc = new TextEncoder();
      const body = new ReadableStream({ start(c) {
        c.enqueue(enc.encode('event: start\ndata: {"index":0,"total":1,"feature":"002-a","title":"A"}\n\n'));
        c.enqueue(enc.encode('event: log\ndata: {"feature":"002-a","text":"WARNING:ClaudeCoderunninginBypassPermissionsmode ... Yes,Iaccept"}\n\n'));
      } });
      return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
    }) as unknown as typeof fetch;
    renderModal({ retryFeature: '002-a' });
    expect(await screen.findByText(/one-time “Bypass Permissions mode” confirmation/)).toBeInTheDocument();
  });

  it('regenerates a spec directly in retry mode', async () => {
    renderModal({ retryFeature: '002-password-reset' });
    await screen.findByText('Review spec →');
    expect(bodies[0].body).toEqual({ set: 's1', feature: '002-password-reset', agentConfig: { agentType: 'openai' } });
  });
});
