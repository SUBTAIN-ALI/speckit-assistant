import { NextRequest, NextResponse } from 'next/server';
import { chatHandlers } from '../../../../adapters/chatbot-di';
import { getWorkspacePath } from '../../../../adapters/primary/api/utils';
import { sseResponse } from '../../../../adapters/primary/api/sse';

export async function POST(req: NextRequest) {
  let body: { conversationId?: string; message?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.message || typeof body.message !== 'string' || !body.message.trim()) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 });
  }

  const workspacePath = getWorkspacePath();

  return sseResponse(async (send) => {
    try {
      const response = await chatHandlers.chat(body as { message: string; conversationId?: string }, workspacePath);
      send('meta', { conversationId: response.conversationId, messageId: response.messageId });
      for await (const chunk of response.stream) {
        send('token', { text: chunk });
      }
      send('done', {});
    } catch (err: any) {
      send('error', { message: err?.message ?? String(err) });
    }
  });
}
