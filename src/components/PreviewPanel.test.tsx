// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PreviewPanel } from './PreviewPanel';

const mockApi = (view: unknown, agentEvents: string[] = []) => {
  const calls: Array<{ url: string; method: string; body?: any }> = [];
  global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url === '/api/preview/agent') {
      return new Response(agentEvents.join(''), { headers: { 'Content-Type': 'text/event-stream' } });
    }
    return new Response(JSON.stringify(view));
  }) as unknown as typeof fetch;
  return calls;
};

describe('PreviewPanel', () => {
  it('offers to prepare the preview with the agent when nothing is set up', async () => {
    const calls = mockApi({ config: null, status: { state: 'stopped', logs: '' } }, [
      'event: log\ndata: {"text":"Inspecting package.json\\n"}\n\n',
      'event: done\ndata: {"ok":false,"message":"Claude finished without writing .specify/preview.json."}\n\n',
    ]);
    render(<PreviewPanel active featureName="001-signup" />);
    fireEvent.click(await screen.findByText(/Prepare preview with your agent/));
    expect(await screen.findByText(/finished without writing/)).toBeTruthy();
    expect(calls).toContainEqual({ url: '/api/preview/agent', method: 'POST', body: { mode: 'prepare', feature: '001-signup' } });
  });

  it('shows the running state with an open-in-browser link', async () => {
    mockApi({ config: { command: 'pnpm dev', path: '/signup' }, status: { state: 'running', url: 'http://localhost:5173', logs: 'ready' } });
    render(<PreviewPanel active featureName={null} />);
    const link = await screen.findByText('Open in Browser');
    expect(link.closest('a')!.getAttribute('href')).toBe('http://localhost:5173/signup');
    expect(screen.getByText('Stop')).toBeTruthy();
    expect(screen.getByText('Preview is running')).toBeTruthy();
  });

  it('shows the failure and its output, and offers the agent fix', async () => {
    const calls = mockApi({ config: { command: 'npm run dev' }, status: { state: 'failed', logs: 'Error: Cannot find module next', error: 'The command exited before the server was ready (exit code 1).' } });
    render(<PreviewPanel active featureName={null} />);
    expect(await screen.findByText(/exited before the server was ready/)).toBeTruthy();
    expect(await screen.findByText(/Cannot find module next/)).toBeTruthy(); // the output opens on failure
    fireEvent.click(screen.getByText(/Fix with your agent/));
    await waitFor(() => expect(calls.some(c => c.url === '/api/preview/agent' && c.body.mode === 'fix')).toBe(true));
  });

  it('saves a command typed by hand', async () => {
    const calls = mockApi({ config: null, status: { state: 'stopped', logs: '' } });
    render(<PreviewPanel active featureName={null} />);
    fireEvent.click(await screen.findByText('enter the command yourself'));
    fireEvent.change(screen.getByPlaceholderText('pnpm dev'), { target: { value: 'flutter run -d web-server --web-port {port}' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(calls.find(c => c.method === 'PUT')?.body).toMatchObject({ command: 'flutter run -d web-server --web-port {port}' }));
  });
});
