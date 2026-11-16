import { NextRequest, NextResponse } from 'next/server';
import { chatHandlers } from '../../../../../adapters/chatbot-di';
import { getWorkspacePath } from '../../../../../adapters/primary/api/utils';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const workspacePath = getWorkspacePath();
    const conversation = await chatHandlers.getConversation(id, workspacePath);
    return NextResponse.json(conversation);
  } catch (err: any) {
    const status = err?.message?.includes('not found') ? 404 : 500;
    return NextResponse.json({ error: err?.message ?? 'Failed to get conversation' }, { status });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const workspacePath = getWorkspacePath();
    await chatHandlers.deleteConversation(id, workspacePath);
    return new NextResponse(null, { status: 204 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Failed to delete conversation' }, { status: 500 });
  }
}
