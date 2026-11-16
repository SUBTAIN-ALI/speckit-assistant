import { WorkspaceRepositoryPort } from '../../ports/out/WorkspaceRepositoryPort';

const MAX_FILE_CHARS = 12_000;

function truncate(text: string, max = MAX_FILE_CHARS): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + '\n\n[...truncated]';
}

export class ProjectContextCollector {
  constructor(private workspaceRepo: WorkspaceRepositoryPort) {}

  async collect(workspacePath: string): Promise<string> {
    const sections: string[] = [];

    const constitution = await this.workspaceRepo.readFile(workspacePath, '.specify/memory/constitution.md');
    if (constitution) {
      sections.push(`## Project Constitution\n\n${truncate(constitution)}`);
    }

    const state = await this.workspaceRepo.getWorkflowState(workspacePath);

    if (state.features.length > 0) {
      sections.push(`## Features Overview\n\n${state.features.map(f => `- **${f.name}**`).join('\n')}`);

      for (const feature of state.features) {
        const parts: string[] = [`### Feature: ${feature.name}`];

        const spec = await this.workspaceRepo.readFile(workspacePath, `specs/${feature.name}/spec.md`);
        if (spec) parts.push(`**Specification:**\n${truncate(spec)}`);

        const reqs = await this.workspaceRepo.readFile(workspacePath, `specs/${feature.name}/requirements.md`);
        if (reqs) parts.push(`**Requirements:**\n${truncate(reqs)}`);

        const plan = await this.workspaceRepo.readFile(workspacePath, `specs/${feature.name}/plan.md`);
        if (plan) parts.push(`**Plan:**\n${truncate(plan)}`);

        const tasks = await this.workspaceRepo.readFile(workspacePath, `specs/${feature.name}/tasks.md`);
        if (tasks) parts.push(`**Tasks:**\n${truncate(tasks)}`);

        const analysis = await this.workspaceRepo.readFile(workspacePath, `specs/${feature.name}/analysis.md`);
        if (analysis) parts.push(`**Analysis:**\n${truncate(analysis)}`);

        if (parts.length > 1) sections.push(parts.join('\n\n'));
      }
    }

    const meetingSetIds = await this.workspaceRepo.listDirectories(workspacePath, '.specify/meetings');
    for (const setId of meetingSetIds) {
      const reqs = await this.workspaceRepo.readFile(workspacePath, `.specify/meetings/${setId}/requirements.md`);
      if (reqs) {
        sections.push(`## Meeting Requirements: ${setId}\n\n${truncate(reqs)}`);
      }
    }

    if (sections.length === 0) {
      return 'This project has no specifications, requirements, or constitution yet.';
    }

    return sections.join('\n\n---\n\n');
  }
}
