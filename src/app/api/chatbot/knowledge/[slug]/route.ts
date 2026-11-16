import { NextRequest, NextResponse } from 'next/server';
import { knowledgeHandlers } from '../../../../../adapters/chatbot-di';
import { getWorkspacePath } from '../../../../../adapters/primary/api/utils';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const workspacePath = getWorkspacePath();
    await knowledgeHandlers.deleteTopic(workspacePath, slug);
    return new NextResponse(null, { status: 204 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Failed to delete topic' }, { status: 500 });
  }
}
