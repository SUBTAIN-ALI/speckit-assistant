import { NextResponse } from 'next/server';
import { chatHandlers } from '../../../../adapters/chatbot-di';
import { getWorkspacePath } from '../../../../adapters/primary/api/utils';

export async function GET() {
  try {
    const workspacePath = getWorkspacePath();
    const conversations = await chatHandlers.listConversations(workspacePath);
    return NextResponse.json({ conversations });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Failed to list conversations' }, { status: 500 });
  }
}
