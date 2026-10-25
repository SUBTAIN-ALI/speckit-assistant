import { NextResponse } from 'next/server';
import { featureCreationService } from '../../../../adapters/di';
import { getWorkspacePath } from '../../../../adapters/primary/api/utils';
import { AgentConfig } from '../../../../domain/models/types';

// Creates Spec Kit features from requirements, streaming SSE events:
//   POST { set, groups, agentConfig }   → create one feature per group
//   POST { set, feature, agentConfig }  → re-generate the spec of an existing linked feature
// Events: warning | start | log | done (per feature), then `complete` with the
// workflow state, or `error`.
export async function POST(req: Request) {
  try {
    const { set, groups, feature, agentConfig } = await req.json();
    if (!agentConfig || typeof agentConfig.agentType !== 'string') {
      return NextResponse.json({ error: 'Select an agent in the Agents section first.' }, { status: 400 });
    }
    const workspacePath = getWorkspacePath();
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: unknown) =>
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        try {
          if (typeof feature === 'string') {
            send('start', { index: 0, total: 1, feature, title: feature });
            const { ok, state } = await featureCreationService.generateSpec(
              workspacePath, set, feature, agentConfig as AgentConfig, text => send('log', { feature, text }));
            send('done', { feature, ok, message: ok ? `spec.md is ready for review in ${feature}.` : `The agent finished without writing specs/${feature}/spec.md.` });
            send('complete', { created: ok ? [feature] : [], failed: ok ? [] : [feature], state });
          } else {
            const result = await featureCreationService.createFeatures(
              workspacePath, set, groups, agentConfig as AgentConfig, e => send(e.type, e));
            send('complete', result);
          }
        } catch (err: any) {
          send('error', { message: err.message });
        }
        controller.close();
      },
    });
    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
