// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

const LIST = {
  current: { path: '/p/quickbite', name: 'quickbite', exists: true, specKit: true },
  recent: [
    { path: '/p/admin-portal', name: 'admin-portal', exists: true, specKit: false },
    { path: '/p/gone', name: 'gone', exists: false, specKit: false },
  ],
};

describe('WorkspaceSwitcher', () => {
  let calls: Array<{ method: string; body?: any }>;
  const reload = vi.fn();

  beforeEach(() => {
    calls = [];
    reload.mockReset();
    Object.defineProperty(window, 'location', { value: { reload }, writable: true });
    global.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, body });
      if (method === 'POST' && body.path === 'relative') return new Response(JSON.stringify({ error: 'Use a full path' }), { status: 400 });
      if (method === 'POST') return new Response(JSON.stringify({ current: { ...LIST.recent[0] } }));
      return new Response(JSON.stringify(LIST));
    }) as unknown as typeof fetch;
  });

  it('shows the open project and switches to a recent one', async () => {
    render(<WorkspaceSwitcher busy={false} />);
    fireEvent.click(await screen.findByText('quickbite'));
    expect(screen.getByText('no Spec Kit')).toBeTruthy();
    expect(screen.getByText('missing')).toBeTruthy();
    expect((screen.getByRole('option', { name: /gone/ }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('option', { name: /admin-portal/ }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(calls).toContainEqual({ method: 'POST', body: { path: '/p/admin-portal' } });
  });

  it('opens a typed folder and shows the server’s error', async () => {
    render(<WorkspaceSwitcher busy={false} />);
    fireEvent.click(await screen.findByText('quickbite'));
    fireEvent.change(screen.getByLabelText('Project folder path'), { target: { value: 'relative' } });
    fireEvent.click(screen.getByText('Open'));
    expect((await screen.findByRole('alert')).textContent).toContain('full path');
    expect(reload).not.toHaveBeenCalled();
  });

  it('blocks switching while an agent is running', async () => {
    render(<WorkspaceSwitcher busy />);
    fireEvent.click(await screen.findByText('quickbite'));
    expect(screen.getByText(/An agent is running/)).toBeTruthy();
    expect((screen.getByRole('option', { name: /admin-portal/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
