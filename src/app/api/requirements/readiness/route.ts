import { NextResponse } from 'next/server';
import { integrationsService, meetingAgentRunner } from '../../../../adapters/di';
import { getWorkspacePath } from '../../../../adapters/primary/api/utils';
import { describeWorkspace } from '../../../../adapters/secondary/fs/workspaceConfig';

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
    // A folder without Spec Kit can't have the meetings extension installed yet,
    // so that's the first thing to fix (and the extension hint would mislead).
    const specKit = describeWorkspace(ws).specKit;
    const withSetup = (problems: string[]) => specKit ? problems : [
      'This project has no Spec Kit yet. Click “Set up Spec Kit” to add it (and the Meeting Requirements extension) to this folder.',
      ...problems.filter(p => !p.includes('Meeting Requirements')),
    ];
    return NextResponse.json({
      engine: view.engine,
      specKit,
      agentLabel: upload.agentLabel ?? null,
      agent: { uploadProblems: withSetup(upload.problems), zoomProblems: withSetup(zoom.problems), zoomServer: zoom.zoomServer?.name ?? null },
      direct: { ready: directReady, provider: view.llm.provider, model: view.llm.models[view.llm.provider] },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
