import { NextResponse } from 'next/server';
import { agentRepository, extensionRepository, specifyCli } from '../../../../adapters/di';
import { bundledExtensionDir, getWorkspacePath } from '../../../../adapters/primary/api/utils';
import { describeWorkspace } from '../../../../adapters/secondary/fs/workspaceConfig';
import { activeAgent } from '../../../../domain/models/agents';
import { BUNDLED_EXTENSIONS } from '../../../../domain/models/extensions';
import { INTEGRATION_FOR_AGENT, buildInitArgs, buildSpecifyArgs } from '../../../../domain/services/specifyArgs';

// "Set up Spec Kit" for the open project: `specify init` with the active agent's
// integration, then the bundled Meeting Requirements extension — what a user
// would otherwise type in a terminal.
//   POST → { success, integration, steps: [{ step, ok, output }] }
export async function POST() {
  try {
    const ws = getWorkspacePath();
    if (!(await specifyCli.isAvailable(ws))) {
      return NextResponse.json({ error: 'The specify CLI isn’t installed. Install it from the Extensions section first.' }, { status: 400 });
    }

    const steps: Array<{ step: string; ok: boolean; output: string }> = [];
    const agent = activeAgent(await agentRepository.getAgents(ws));
    const integration = INTEGRATION_FOR_AGENT[agent?.agentType ?? 'claude'];

    if (!describeWorkspace(ws).specKit) {
      const init = await specifyCli.run(ws, buildInitArgs(integration));
      steps.push({ step: `specify init (${integration})`, ok: init.code === 0, output: init.output });
      if (init.code !== 0 || !describeWorkspace(ws).specKit) {
        return NextResponse.json({ success: false, integration, steps, error: 'Spec Kit setup failed. See the output below.' }, { status: 500 });
      }
    }

    const meetings = BUNDLED_EXTENSIONS.find(b => b.id === 'meetings')!;
    const installed = await extensionRepository.listInstalled(ws);
    if (!installed.some(e => e.id === meetings.id && e.enabled)) {
      const add = await specifyCli.run(ws, buildSpecifyArgs({ action: 'install-bundled', path: bundledExtensionDir(meetings.dir) }));
      steps.push({ step: 'install Meeting Requirements', ok: add.code === 0, output: add.output });
    }

    const success = steps.every(s => s.ok);
    return NextResponse.json(
      { success, integration, steps, ...(success ? {} : { error: 'Spec Kit is set up, but installing Meeting Requirements failed. Install it from the Extensions section.' }) },
      { status: success ? 200 : 500 }
    );
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
