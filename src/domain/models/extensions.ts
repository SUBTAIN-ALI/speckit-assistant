// An extension currently installed in the workspace (read from
// .specify/extensions/.registry + each extension.yml).
export type InstalledExtension = {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  source?: string;
  commandCount: number;
  commands: string[]; // command names from extension.yml, e.g. "speckit.personas.qa"
  hookCount: number;
  priority?: number;
  description?: string;
};

// An extension bundled with this app, installable via `specify extension add <dir> --dev`.
export type BundledExtension = {
  id: string;
  label: string;
  description: string;
  dir: string; // directory name under the app's extensions/ folder
};

export const BUNDLED_EXTENSIONS: BundledExtension[] = [
  {
    id: 'personas',
    label: 'Review Personas',
    description: 'Implementation review-gate sub-agents: QA, Code Review, Security, Tech Lead.',
    dir: 'spec-kit-personas',
  },
  {
    id: 'spec-agents',
    label: 'Specification Agents',
    description: 'Specification-phase agents: Product Owner, Architecture, Technical Refinement, Consolidate.',
    dir: 'spec-kit-spec-agents',
  },
  {
    id: 'devops',
    label: 'DevOps Agents',
    description: 'On-demand operational agents: Deploy, post-deploy Monitoring, Troubleshooting.',
    dir: 'spec-kit-devops',
  },
  {
    id: 'meetings',
    label: 'Meeting Requirements',
    description: 'Meeting → requirements (Zoom via MCP, or a transcript) and requirements → feature grouping, run by your active agent.',
    dir: 'spec-kit-meetings',
  },
];
