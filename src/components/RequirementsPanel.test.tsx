// @vitest-environment jsdom
import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { RequirementsPanel } from './RequirementsPanel';
import { RequirementsDoc } from '../domain/models/requirements';
import { addRequirement, deleteRequirement, restoreRequirement, updateRequirement } from '../domain/services/requirementsOps';

const DOC: RequirementsDoc = {
  meta: { nextId: 3, title: 'Checkout' },
  requirements: [
    { id: 'REQ-001', title: 'Reset password by email', type: 'functional', priority: 'must', status: 'draft', description: 'Send a link.', acceptanceCriteria: ['Expires in 30 min'], source: { timestamp: '00:12:41', speaker: 'Sarah', quote: 'locked out' } },
    { id: 'REQ-002', title: 'Page loads under 2s', type: 'non-functional', priority: 'should', status: 'accepted', description: '', acceptanceCriteria: [] },
  ],
};

// A tiny in-memory backend for /api/requirements, using the real domain ops.
let serverDoc: RequirementsDoc;
function installFetch() {
  global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url, 'http://localhost');
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const ok = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
    if (init?.method === 'PATCH') { serverDoc = updateRequirement(serverDoc, body.id, body.patch); return ok({ doc: serverDoc }); }
    if (init?.method === 'DELETE') { const r = deleteRequirement(serverDoc, u.searchParams.get('id')!); serverDoc = r.doc; return ok(r); }
    if (init?.method === 'POST' && body.restore) { serverDoc = restoreRequirement(serverDoc, body.restore.requirement, body.restore.index); return ok({ doc: serverDoc }); }
    if (init?.method === 'POST') { const r = addRequirement(serverDoc, body.requirement); serverDoc = r.doc; return ok(r); }
    return ok({ doc: serverDoc });
  }) as unknown as typeof fetch;
}

function Harness({ onImport = () => {}, onOpenFeature }: { onImport?: () => void; onOpenFeature?: (f: string) => void }) {
  const [doc, setDoc] = useState<RequirementsDoc | null>(serverDoc);
  return <RequirementsPanel setId="2026-10-25-sync" doc={doc} onDocChange={setDoc} onImport={onImport} onOpenFeature={onOpenFeature} />;
}

describe('RequirementsPanel', () => {
  const realFetch = global.fetch;
  beforeEach(() => { serverDoc = JSON.parse(JSON.stringify(DOC)); installFetch(); });
  afterEach(() => { global.fetch = realFetch; });

  it('renders requirements grouped by type with source quotes', () => {
    render(<Harness />);
    expect(screen.getByText('Functional · 1')).toBeInTheDocument();
    expect(screen.getByText('Non-functional · 1')).toBeInTheDocument();
    expect(screen.getByText('Reset password by email')).toBeInTheDocument();
    expect(screen.getByText(/locked out/)).toBeInTheDocument();
    expect(screen.getByText('Expires in 30 min')).toBeInTheDocument();
  });

  it('accepts a draft', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText('Accept REQ-001'));
    await waitFor(() => expect(serverDoc.requirements[0].status).toBe('accepted'));
    expect(screen.queryByText(/Accept all drafts/)).not.toBeInTheDocument();
  });

  it('edits a requirement inline', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText('Edit REQ-002'));
    const title = screen.getByLabelText('Title');
    fireEvent.change(title, { target: { value: 'Page loads under 1s' } });
    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(screen.getByText('Page loads under 1s')).toBeInTheDocument());
    expect(serverDoc.requirements[1].title).toBe('Page loads under 1s');
  });

  it('deletes with undo', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText('Delete REQ-001'));
    const toast = await screen.findByRole('status');
    expect(within(toast).getByText(/Deleted REQ-001/)).toBeInTheDocument();
    expect(screen.queryByText('Reset password by email')).not.toBeInTheDocument();
    fireEvent.click(within(toast).getByText('Undo'));
    await waitFor(() => expect(screen.getByText('Reset password by email')).toBeInTheDocument());
    expect(serverDoc.requirements.map(r => r.id)).toEqual(['REQ-001', 'REQ-002']);
  });

  it('adds a requirement and validates the title', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('Add'));
    fireEvent.click(screen.getByText('Add requirement'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Give the requirement a title');
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Audit log' } });
    fireEvent.change(screen.getByLabelText(/Acceptance criteria/), { target: { value: '- Records who\n\nRecords when' } });
    fireEvent.click(screen.getByText('Add requirement'));
    await waitFor(() => expect(screen.getByText('Audit log')).toBeInTheDocument());
    expect(serverDoc.requirements[2]).toMatchObject({ id: 'REQ-003', title: 'Audit log', acceptanceCriteria: ['Records who', 'Records when'] });
  });

  it('shows the feature a requirement became and opens it', () => {
    serverDoc.requirements[1].feature = '005-performance';
    const onOpenFeature = vi.fn();
    render(<Harness onOpenFeature={onOpenFeature} />);
    fireEvent.click(screen.getByText('005-performance'));
    expect(onOpenFeature).toHaveBeenCalledWith('005-performance');
  });

  it('sends the set id to the API', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText('Accept REQ-001'));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [, init] = (global.fetch as any).mock.calls[0];
    expect(JSON.parse(init.body)).toMatchObject({ set: '2026-10-25-sync', id: 'REQ-001' });
  });

  it('filters by search text', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Search requirements'), { target: { value: 'csv' } });
    expect(screen.getByText('No requirements match these filters.')).toBeInTheDocument();
  });

  it('shows the empty state with an import action', () => {
    serverDoc = { meta: { nextId: 1 }, requirements: [] };
    const onImport = vi.fn();
    render(<Harness onImport={onImport} />);
    fireEvent.click(screen.getByText('Import from meeting'));
    expect(onImport).toHaveBeenCalled();
  });
});
