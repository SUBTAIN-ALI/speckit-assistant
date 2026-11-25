// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EpsPanel } from './EpsPanel';
import { emptyEpsState } from '../domain/models/eps';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('EPS panel', () => {
  it('saves a token without returning it and imports only a selected requirement', async () => {
    const state = { ...emptyEpsState(), configured: false };
    const requirement = { id: '12345678-1234-4321-8765-123456789abc', title: 'Export orders', businessOutcome: 'CSV', acceptanceCriteria: [], released: true, stage: 'plan_review', updatedAt: '2026-11-18T12:00:00Z' };
    const calls: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      if (body) calls.push(body);
      if (init?.method === 'PUT') state.configured = true;
      if (body?.action === 'discover') return { ok: true, json: async () => ({ requirements: [requirement] }) };
      if (body?.action === 'import') return { ok: true, json: async () => ({ setId: 'eps-list' }) };
      return { ok: true, json: async () => ({ ...state }) };
    }));
    render(<EpsPanel onBack={vi.fn()} onOpenList={vi.fn()} />);
    await screen.findByLabelText('EPS machine token');
    expect(calls).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('EPS machine token'), { target: { value: 'eps_mcp_secret' } });
    fireEvent.click(screen.getByText('Save connection'));
    await screen.findByText('EPS connection settings saved.');
    expect(screen.getByLabelText('EPS machine token')).toHaveValue('');
    fireEvent.click(screen.getByText('Browse EPS'));
    await screen.findByText('Export orders');
    expect(calls.some(c => c.action === 'import')).toBe(false);
    fireEvent.click(screen.getByText('Import to this project'));
    await waitFor(() => expect(calls.some(c => c.action === 'import' && c.id === requirement.id)).toBe(true));
  });
  it('shows connection errors and keeps existing navigation usable', async () => {
    const back = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error: 'Connection unavailable' }) })));
    render(<EpsPanel onBack={back} onOpenList={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection unavailable');
    fireEvent.click(screen.getByText('Back to requirements')); expect(back).toHaveBeenCalledOnce();
  });
});
