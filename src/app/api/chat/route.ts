import { NextRequest, NextResponse } from 'next/server';
import { chatService } from '../../../adapters/di';
import { getWorkspacePath } from '../../../adapters/primary/api/utils';
import { sseResponse } from '../../../adapters/primary/api/sse';
import { ChatMessage } from '../../../domain/ports/out/ChatLlmPort';

export async function POST(req: NextRequest) {
  let body: { messages?: ChatMessage[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: 'messages must be a non-empty array' }, { status: 400 });
  }

  const workspacePath = getWorkspacePath();

  return sseResponse(async (send) => {
    try {
      for await (const chunk of chatService.chat(workspacePath, messages)) {
        send('token', { text: chunk });
      }
      send('done', {});
    } catch (err: any) {
      send('error', { message: err?.message ?? String(err) });
    }
  });
}
