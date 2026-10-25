import { NextResponse } from 'next/server';
import { featureCreationService } from '../../../../adapters/di';
import { getWorkspacePath } from '../../../../adapters/primary/api/utils';
import { FeatureCreationError } from '../../../../domain/services/FeatureCreationService';
import { RequirementError } from '../../../../domain/services/requirementsOps';

// POST { set, ids } → { groups, unassigned }: the AI's suggested split into features.
export async function POST(req: Request) {
  try {
    const { set, ids } = await req.json();
    if (!Array.isArray(ids)) return NextResponse.json({ error: 'ids must be a list of requirement ids' }, { status: 400 });
    return NextResponse.json(await featureCreationService.proposeGrouping(getWorkspacePath(), set, ids));
  } catch (err: any) {
    const status = err instanceof FeatureCreationError || err instanceof RequirementError ? 400 : 500;
    return NextResponse.json({ error: err.message }, { status });
  }
}
