// Quick build: the user goes from an approved spec straight to code, skipping
// Clarify → Tasks. The agent understands the feature and the existing project
// itself, keeps Spec Kit's structure (a tasks.md), and never waits for answers.

const NO_QUESTIONS = `Nobody will answer questions during this run: the user chose a quick build and skipped clarification and planning. Never stop to ask (no "proceed? yes/no", no halting on incomplete checklists). Make each decision yourself, sensibly and in line with the spec and the existing code, and record it under "## Assumptions" at the top of tasks.md and in your final report.`;

const UNDERSTAND_PROJECT = `Before writing code, understand the existing project and build into it, not next to it:
- its stack, folder layout and conventions (package files, frameworks, naming, linting, how tests are written);
- what already exists that this feature should reuse or extend (routes, models, components, services) — never re-create it;
- the project's own build/test commands, to check your work.
If the project has no code yet, take the stack from .specify/memory/constitution.md or plan.md; if neither says, choose a mainstream stack that fits the spec and record it under Assumptions.
Build only what the spec asks for.`;

// The feature already has tasks.md: /speckit.implement follows it; this goes before the command.
export function quickBuildContext(): string {
  return `${NO_QUESTIONS}\n\n${UNDERSTAND_PROJECT}`;
}

// No tasks.md yet: the agent writes one (Spec Kit's template), then implements it.
export function quickBuildInstruction(feature: string): string {
  return `Quick build of the feature in specs/${feature}/: implement it now.

1. Read every document the feature has in specs/${feature}/ (spec.md, and plan.md, research.md, data-model.md, contracts/, quickstart.md, checklists/ if they exist) and .specify/memory/constitution.md.

2. ${UNDERSTAND_PROJECT}

3. Write specs/${feature}/tasks.md in the format of .specify/templates/tasks-template.md (if that file is missing, use "- [ ] T001 …" checkboxes grouped in phases). Start it with:
   > Quick build — generated from the spec without the Clarify/Plan/Tasks phases.
   followed by a "## Assumptions" section listing every decision clarification or planning would have settled (stack, unclear rules, defaults). Keep the task list proportionate to the feature.

4. Implement the tasks in order. Tick each task in tasks.md ("- [x]") as soon as it is done, so progress is visible. Run the project's tests/build where they exist and fix what you broke.

5. ${NO_QUESTIONS}

Finish with a short report: what you built, the assumptions, and anything the user must do (e.g. env values).`;
}
