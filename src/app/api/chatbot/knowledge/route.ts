import { NextRequest, NextResponse } from 'next/server';
import { knowledgeHandlers } from '../../../../adapters/chatbot-di';
import { getWorkspacePath } from '../../../../adapters/primary/api/utils';

export async function GET() {
  try {
    const workspacePath = getWorkspacePath();
    const topics = await knowledgeHandlers.list(workspacePath);
    return NextResponse.json({ topics });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Failed to list knowledge' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const workspacePath = getWorkspacePath();

    if (body.action === 'prepare') {
      const change = await knowledgeHandlers.prepare(workspacePath, body);
      return NextResponse.json(change);
    }

    if (body.action === 'save') {
      await knowledgeHandlers.save(workspacePath, body);
      return new NextResponse(null, { status: 204 });
    }

    return NextResponse.json({ error: 'Invalid action. Use "prepare" or "save".' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Knowledge operation failed' }, { status: 500 });
  }
}
