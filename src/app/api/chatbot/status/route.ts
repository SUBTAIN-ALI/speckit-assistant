import { NextResponse } from 'next/server';
import { getChatbotStatus } from '../../../../adapters/chatbot-di';
import { getWorkspacePath } from '../../../../adapters/primary/api/utils';

export async function GET() {
  try {
    const workspacePath = getWorkspacePath();
    const status = await getChatbotStatus(workspacePath);
    return NextResponse.json(status);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Failed to get status' }, { status: 500 });
  }
}
