import { NextResponse } from 'next/server';
import { featureCreationService } from '../../../../adapters/di';
import { getWorkspacePath } from '../../../../adapters/primary/api/utils';
import { sseResponse } from '../../../../adapters/primary/api/sse';
import { AgentConfig } from '../../../../domain/models/types';

// Creates Spec Kit features from requirements, streaming SSE events:
//   POST { set, groups, agentConfig }   → create one feature per group
//   POST { set, feature, agentConfig }  → re-generate the spec of an existing linked feature
// Events: start | log | done (per feature), then `complete` with the workflow
// state, or `error`. The work continues if the client disconnects.
export async function POST(req: Request) {
  try {
    const { set, groups, feature, agentConfig } = await req.json();
    if (!agentConfig || typeof agentConfig.agentType !== 'string') {
      return NextResponse.json({ error: 'Select an agent in the Agents section first.' }, { status: 400 });
    }
    const workspacePath = getWorkspacePath();
    return sseResponse(async send => {
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
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
