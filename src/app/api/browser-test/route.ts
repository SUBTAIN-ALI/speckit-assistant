import { NextResponse } from 'next/server';
import { workflowService } from '../../../adapters/di';
import { getWorkspacePath } from '../../../adapters/primary/api/utils';
import { AgentConfig } from '../../../domain/models/types';
import { BrowserTestConfig, BrowserTestStatus } from '../../../domain/models/browserTest';

export async function POST(req: Request) {
  try {
    const { featureName, agentConfig, config } = await req.json();
    if (!featureName) return NextResponse.json({ error: 'Missing featureName' }, { status: 400 });

    const workspacePath = getWorkspacePath();

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (event: string, data: any) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };
        try {
          const result = await workflowService.runBrowserTest(
            workspacePath,
            featureName,
            agentConfig as AgentConfig,
            config as BrowserTestConfig | undefined,
            (text: string) => sendEvent('log', { text }),
            (status: BrowserTestStatus) => sendEvent('status', { status })
          );
          sendEvent('done', result);
          controller.close();
        } catch (err: any) {
          sendEvent('error', { message: err.message });
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
