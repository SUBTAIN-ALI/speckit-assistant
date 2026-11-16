import { NextResponse } from 'next/server';
import { workflowService } from '../../../adapters/di';
import { getWorkspacePath } from '../../../adapters/primary/api/utils';
import {
  buildExpertiseProfile,
  DEFAULT_EXPERTISE_PROFILE,
  TechnicalLevel,
  DomainKnowledge,
} from '../../../domain/models/types';

export async function GET() {
  try {
    const workspacePath = getWorkspacePath();
    const state = await workflowService.getWorkflowState(workspacePath);
    return NextResponse.json(state.expertiseProfile ?? DEFAULT_EXPERTISE_PROFILE);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const workspacePath = getWorkspacePath();
    const body = await req.json();

    const { technicalLevel, domainKnowledge, domainContext } = body;

    if (!technicalLevel || !['technical', 'non-technical'].includes(technicalLevel)) {
      return NextResponse.json(
        { error: 'technicalLevel must be "technical" or "non-technical"' },
        { status: 400 }
      );
    }
    if (!domainKnowledge || !['has-domain', 'no-domain'].includes(domainKnowledge)) {
      return NextResponse.json(
        { error: 'domainKnowledge must be "has-domain" or "no-domain"' },
        { status: 400 }
      );
    }

    const profile = buildExpertiseProfile(
      technicalLevel as TechnicalLevel,
      domainKnowledge as DomainKnowledge,
      typeof domainContext === 'string' ? domainContext.trim() || undefined : undefined
    );

    const state = await workflowService.setExpertiseProfile(workspacePath, profile);
    return NextResponse.json(state.expertiseProfile);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
