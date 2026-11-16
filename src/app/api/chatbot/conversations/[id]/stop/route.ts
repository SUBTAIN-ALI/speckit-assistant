import { NextRequest, NextResponse } from 'next/server';
import { chatHandlers } from '../../../../../../adapters/chatbot-di';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const stopped = chatHandlers.stopConversation(id);
    return NextResponse.json({ stopped });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Failed to stop conversation' }, { status: 500 });
  }
}
