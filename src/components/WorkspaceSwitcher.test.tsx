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
  let browsed: string[];
  const reload = vi.fn();

  beforeEach(() => {
    calls = [];
    browsed = [];
    reload.mockReset();
    Object.defineProperty(window, 'location', { value: { reload }, writable: true });
    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (url.startsWith('/api/workspace/browse')) {
        const dir = new URL(url, 'http://x').searchParams.get('path')!;
        browsed.push(dir);
        if (dir === '/private') return new Response(JSON.stringify({ error: 'macOS doesn’t allow reading /private.' }), { status: 403 });
        return new Response(JSON.stringify({
          path: dir, parent: '/', specKit: dir === '/p/quickbite', places: [{ name: 'Home', path: '/p' }],
          folders: dir === '/p' ? [{ name: 'admin-portal', path: '/p/admin-portal', specKit: false }, { name: 'quickbite', path: '/p/quickbite', specKit: true }] : [],
        }));
      }
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, body });
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

  it('browses into folders and opens the chosen one', async () => {
    render(<WorkspaceSwitcher busy={false} />);
    fireEvent.click(await screen.findByText('quickbite'));
    fireEvent.click(screen.getByText(/Browse folders/));
    // Starts in the folder that holds the open project.
    expect(await screen.findByRole('option', { name: /admin-portal/ })).toBeTruthy();
    expect(browsed).toEqual(['/p']);

    fireEvent.click(screen.getByRole('option', { name: /admin-portal/ })); // go in
    await waitFor(() => expect(browsed).toEqual(['/p', '/p/admin-portal']));
    fireEvent.click(await screen.findByText('Open this folder'));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(calls).toContainEqual({ method: 'POST', body: { path: '/p/admin-portal' } });
  });

  it('shows why a folder can’t be opened', async () => {
    render(<WorkspaceSwitcher busy={false} />);
    fireEvent.click(await screen.findByText('quickbite'));
    fireEvent.click(screen.getByText(/Browse folders/));
    fireEvent.change(await screen.findByLabelText('Go to folder path'), { target: { value: '/private' } });
    fireEvent.submit(screen.getByLabelText('Go to folder path').closest('form')!);
    expect((await screen.findByRole('alert')).textContent).toContain('doesn’t allow');
  });

  it('blocks switching while an agent is running', async () => {
    render(<WorkspaceSwitcher busy />);
    fireEvent.click(await screen.findByText('quickbite'));
    expect(screen.getByText(/An agent is running/)).toBeTruthy();
    expect((screen.getByRole('option', { name: /admin-portal/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
