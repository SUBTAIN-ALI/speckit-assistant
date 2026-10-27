import { NextResponse } from 'next/server';
import { workflowService } from '../../../adapters/di';
import { getWorkspacePath } from '../../../adapters/primary/api/utils';

export async function POST(req: Request) {
  try {
    // { filePath, lineIndex, checked }: the file being viewed (checklists too);
    // { featureName, lineIndex, checked }: that feature's tasks.md (older clients).
    const { filePath, featureName, lineIndex, checked } = await req.json();
    if ((!filePath && !featureName) || typeof lineIndex !== 'number' || typeof checked !== 'boolean') {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }
    const workspacePath = getWorkspacePath();
    const state = typeof filePath === 'string'
      ? await workflowService.toggleCheckbox(workspacePath, filePath, lineIndex, checked)
      : await workflowService.toggleTask(workspacePath, featureName, lineIndex, checked);
    return NextResponse.json(state);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
