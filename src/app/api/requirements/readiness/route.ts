import { NextResponse } from 'next/server';
import { integrationsService, meetingAgentRunner } from '../../../../adapters/di';
import { getWorkspacePath } from '../../../../adapters/primary/api/utils';

export const dynamic = 'force-dynamic';

// What the Requirements section needs before importing / grouping with the
// current engine. Agent engine: active agent + meetings extension (+ Zoom MCP
// assigned to the agent for Zoom links). Direct engine: an API key.
export async function GET() {
  try {
    const ws = getWorkspacePath();
    const [view, upload, zoom] = await Promise.all([
      integrationsService.getView(),
      meetingAgentRunner.readiness(ws, false),
      meetingAgentRunner.readiness(ws, true),
    ]);
    const directReady = view.llm.configured[view.llm.provider];
    return NextResponse.json({
      engine: view.engine,
      agentLabel: upload.agentLabel ?? null,
      agent: { uploadProblems: upload.problems, zoomProblems: zoom.problems, zoomServer: zoom.zoomServer?.name ?? null },
      direct: { ready: directReady, provider: view.llm.provider, model: view.llm.models[view.llm.provider] },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
