'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Rocket,
  FolderCheck,
  Bot,
  FileText,
  CheckCircle2,
  Circle,
  ChevronRight,
  ArrowRight,
  Loader2,
  Upload,
  Sparkles,
  ExternalLink,
} from 'lucide-react';

type StepId = 'welcome' | 'speckit' | 'agent' | 'create';

type StepStatus = 'done' | 'active' | 'upcoming';

type Step = {
  id: StepId;
  title: string;
  icon: React.ReactNode;
};

type Props = {
  hasFeatures: boolean;
  hasSpecKit: boolean;
  hasAgent: boolean;
  onSetUpSpecKit: () => Promise<void>;
  onNavigate: (section: 'agents' | 'requirements') => void;
  onDismiss: () => void;
};

const STEPS: Step[] = [
  { id: 'welcome', title: 'Welcome', icon: <Rocket size={16} /> },
  { id: 'speckit', title: 'Set Up Spec Kit', icon: <FolderCheck size={16} /> },
  { id: 'agent', title: 'Connect Your Coding Tool', icon: <Bot size={16} /> },
  { id: 'create', title: 'Start Building', icon: <FileText size={16} /> },
];

export const GettingStartedGuide: React.FC<Props> = ({
  hasFeatures,
  hasSpecKit,
  hasAgent,
  onSetUpSpecKit,
  onNavigate,
  onDismiss,
}) => {
  const [settingUp, setSettingUp] = useState(false);
  const [setupDone, setSetupDone] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);

  const getStepStatus = useCallback(
    (id: StepId): StepStatus => {
      switch (id) {
        case 'welcome':
          return 'done';
        case 'speckit':
          return hasSpecKit || setupDone ? 'done' : 'active';
        case 'agent':
          if (!hasSpecKit && !setupDone) return 'upcoming';
          return hasAgent ? 'done' : 'active';
        case 'create':
          if (!hasSpecKit && !setupDone) return 'upcoming';
          if (!hasAgent) return 'upcoming';
          return 'active';
        default:
          return 'upcoming';
      }
    },
    [hasSpecKit, hasAgent, setupDone]
  );

  const activeStep: StepId =
    getStepStatus('speckit') === 'active'
      ? 'speckit'
      : getStepStatus('agent') === 'active'
        ? 'agent'
        : 'create';

  const [selectedStep, setSelectedStep] = useState<StepId>(activeStep);

  useEffect(() => {
    setSelectedStep(activeStep);
  }, [activeStep]);

  const handleSetUpSpecKit = async () => {
    setSettingUp(true);
    setSetupError(null);
    try {
      await onSetUpSpecKit();
      setSetupDone(true);
    } catch (err: any) {
      setSetupError(err.message || 'Setup failed. Try again or set up manually from the Requirements section.');
    } finally {
      setSettingUp(false);
    }
  };

  const statusIcon = (status: StepStatus) => {
    if (status === 'done')
      return <CheckCircle2 size={14} className="text-emerald-500" />;
    if (status === 'active')
      return <Circle size={14} className="text-blue-500" />;
    return <Circle size={14} className="text-zinc-300 dark:text-zinc-700" />;
  };

  return (
    <div className="flex items-center justify-center h-full p-6">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-full mb-4">
            <Sparkles size={12} className="text-blue-500" />
            <span className="text-[11px] font-semibold text-blue-700 dark:text-blue-300">Getting Started</span>
          </div>
          <h2 className="text-lg font-bold text-zinc-900 dark:text-white tracking-tight">
            Welcome to Spec Rabbit
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1 max-w-md mx-auto">
            Turn ideas into production-ready code through Spec-Driven Development.
            Let's get your project set up in a few quick steps.
          </p>
        </div>

        {/* Steps + Content */}
        <div className="flex gap-6">
          {/* Step list (left rail) */}
          <div className="w-48 shrink-0 space-y-1">
            {STEPS.map((step) => {
              const status = getStepStatus(step.id);
              const isSelected = selectedStep === step.id;
              return (
                <button
                  key={step.id}
                  onClick={() => setSelectedStep(step.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition text-xs font-medium ${
                    isSelected
                      ? 'bg-zinc-100 dark:bg-zinc-900 text-zinc-900 dark:text-white'
                      : status === 'upcoming'
                        ? 'text-zinc-400 dark:text-zinc-600'
                        : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900/50'
                  }`}
                >
                  {statusIcon(status)}
                  <span className="truncate">{step.title}</span>
                </button>
              );
            })}

            <div className="pt-3 mt-3 border-t border-zinc-200 dark:border-zinc-800">
              <button
                onClick={onDismiss}
                className="w-full px-3 py-2 text-[11px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition text-left"
              >
                Skip setup guide
              </button>
            </div>
          </div>

          {/* Content panel (right) */}
          <div className="flex-1 border border-zinc-200 dark:border-zinc-800 rounded-xl bg-zinc-50/50 dark:bg-zinc-950/30 p-5 min-h-[260px] max-h-[420px] overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
            {selectedStep === 'welcome' && <WelcomeContent />}
            {selectedStep === 'speckit' && (
              <SpecKitContent
                done={hasSpecKit || setupDone}
                loading={settingUp}
                error={setupError}
                onSetUp={handleSetUpSpecKit}
              />
            )}
            {selectedStep === 'agent' && (
              <AgentContent
                done={hasAgent}
                blocked={!hasSpecKit && !setupDone}
                onGoToAgents={() => { onNavigate('agents'); onDismiss(); }}
              />
            )}
            {selectedStep === 'create' && (
              <CreateContent
                blocked={(!hasSpecKit && !setupDone) || !hasAgent}
                onGoToRequirements={() => { onNavigate('requirements'); onDismiss(); }}
                onDismiss={onDismiss}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

function WelcomeContent() {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-zinc-900 dark:text-white">What is Spec Rabbit?</h3>
      <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
        Spec Rabbit is a visual orchestrator for <strong className="text-zinc-800 dark:text-zinc-200">Spec-Driven Development (SDD)</strong> — a workflow
        where you define <em>what</em> to build before <em>how</em> to build it. AI agents then turn your
        specifications into production-ready code, reviewed at every step.
      </p>

      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Quick setup (terminal):</h4>
        <div className="space-y-1.5">
          <div className="rounded-lg bg-zinc-900 dark:bg-zinc-900 border border-zinc-800 p-3 font-mono text-[11px] text-zinc-100 space-y-2">
            <div>
              <span className="text-zinc-500"># Run directly — no install needed</span>
              <div className="flex items-center gap-2">
                <span className="text-emerald-400 select-none">$</span>
                <span>npx speckit-assistant</span>
              </div>
            </div>
            <div>
              <span className="text-zinc-500"># Or point it at your project</span>
              <div className="flex items-center gap-2">
                <span className="text-emerald-400 select-none">$</span>
                <span>npx speckit-assistant /path/to/your/project</span>
              </div>
            </div>
            <div>
              <span className="text-zinc-500"># Or install globally for quick access</span>
              <div className="flex items-center gap-2">
                <span className="text-emerald-400 select-none">$</span>
                <span>npm install -g speckit-assistant</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-emerald-400 select-none">$</span>
                <span>speckit-assistant -w /path/to/your/project</span>
              </div>
            </div>
          </div>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
            This starts the dashboard on <code className="px-1 py-0.5 bg-zinc-200 dark:bg-zinc-800 rounded text-[10px]">localhost:18080</code> and opens it in your browser.
            Use <code className="px-1 py-0.5 bg-zinc-200 dark:bg-zinc-800 rounded text-[10px]">-p PORT</code> to change the port.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">How it works:</h4>
        <div className="space-y-1.5">
          {[
            { num: '1', label: 'Define requirements', desc: 'Import from meetings, documents, or write them directly.' },
            { num: '2', label: 'Generate specifications', desc: 'AI turns requirements into detailed, structured specs.' },
            { num: '3', label: 'Review and refine', desc: 'Clarify, plan, and create task checklists — all reviewable.' },
            { num: '4', label: 'Implement with AI', desc: 'Your coding agent builds the feature, guided by the spec.' },
          ].map((item) => (
            <div key={item.num} className="flex gap-2.5 items-start">
              <span className="shrink-0 w-5 h-5 rounded-full bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-[10px] font-bold flex items-center justify-center">
                {item.num}
              </span>
              <div>
                <span className="text-xs font-medium text-zinc-800 dark:text-zinc-200">{item.label}</span>
                <span className="text-xs text-zinc-500 dark:text-zinc-500"> — {item.desc}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SpecKitContent({
  done,
  loading,
  error,
  onSetUp,
}: {
  done: boolean;
  loading: boolean;
  error: string | null;
  onSetUp: () => void;
}) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-zinc-900 dark:text-white">Set Up Spec Kit</h3>

      {done ? (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
          <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />
          <p className="text-xs text-emerald-700 dark:text-emerald-300 font-medium">
            Spec Kit is set up for this project. You're good to go!
          </p>
        </div>
      ) : (
        <>
          <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
            Spec Kit creates a <code className="px-1 py-0.5 bg-zinc-200 dark:bg-zinc-800 rounded text-[11px]">.specify/</code> folder in
            your project that holds configuration, extensions, and runtime state. This is where
            Spec Rabbit stores specs, plans, and task checklists for each feature.
          </p>

          <div className="p-3 rounded-lg bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mb-1 font-medium">What this does:</p>
            <ul className="space-y-1">
              {[
                'Runs specify init to create the .specify/ directory',
                'Installs the Meeting Requirements extension (for importing meetings)',
                'Configures the project for your active agent',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2 text-[11px] text-zinc-600 dark:text-zinc-400">
                  <ChevronRight size={10} className="mt-0.5 shrink-0 text-zinc-400" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="p-3 rounded-lg bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mb-1 font-medium">Or run manually from your project terminal:</p>
            <div className="rounded-md bg-zinc-900 dark:bg-zinc-950 border border-zinc-800 p-2.5 font-mono text-[11px] text-zinc-100 space-y-2">
              <div>
                <span className="text-zinc-500"># Connect with Claude Code</span>
                <div className="flex items-center gap-2">
                  <span className="text-emerald-400 select-none">$</span>
                  <span>specify init --here --integration claude --force</span>
                </div>
              </div>
              <div>
                <span className="text-zinc-500"># Or connect with Codex (OpenAI)</span>
                <div className="flex items-center gap-2">
                  <span className="text-emerald-400 select-none">$</span>
                  <span>specify init --here --integration codex --force</span>
                </div>
              </div>
              <div>
                <span className="text-zinc-500"># Or connect with Gemini</span>
                <div className="flex items-center gap-2">
                  <span className="text-emerald-400 select-none">$</span>
                  <span>specify init --here --integration gemini --force</span>
                </div>
              </div>
            </div>
            <p className="text-[10px] text-zinc-400 mt-1.5">
              This creates the <code className="px-1 py-0.5 bg-zinc-200 dark:bg-zinc-800 rounded">.specify/</code> folder
              and wires it to your chosen AI tool.
              Run the same command to switch integrations later.
              Requires the <code className="px-1 py-0.5 bg-zinc-200 dark:bg-zinc-800 rounded">specify</code> CLI — install it from the Extensions tab.
            </p>
          </div>

          {error && (
            <p className="text-[11px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 rounded-lg p-2.5 border border-red-200 dark:border-red-800">
              {error}
            </p>
          )}

          <button
            onClick={onSetUp}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-black dark:bg-white text-white dark:text-black rounded-lg text-xs font-semibold hover:opacity-90 disabled:opacity-50 transition"
          >
            {loading ? (
              <>
                <Loader2 size={13} className="animate-spin" /> Setting up…
              </>
            ) : (
              <>
                <FolderCheck size={13} /> Set up Spec Kit
              </>
            )}
          </button>
        </>
      )}
    </div>
  );
}

function AgentContent({
  done,
  blocked,
  onGoToAgents,
}: {
  done: boolean;
  blocked: boolean;
  onGoToAgents: () => void;
}) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-zinc-900 dark:text-white">Connect Your Coding Tool</h3>

      {blocked ? (
        <p className="text-xs text-zinc-400 dark:text-zinc-600 italic">
          Complete the previous step first.
        </p>
      ) : done ? (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
          <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />
          <p className="text-xs text-emerald-700 dark:text-emerald-300 font-medium">
            An agent is configured and ready. You can change it anytime from the Agents tab.
          </p>
        </div>
      ) : (
        <>
          <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
            Spec Rabbit uses AI coding agents to generate specs, plans, and code. Connect the
            CLI tool you use for AI-assisted coding.
          </p>

          <div className="space-y-3">
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 font-medium">Install and enable a coding CLI (pick one):</p>

            {/* Claude Code */}
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-hidden">
              <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
                <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">Claude Code</span>
                <span className="text-[10px] text-zinc-400 ml-1.5">Anthropic</span>
              </div>
              <div className="p-2.5 rounded-b-lg bg-zinc-900 dark:bg-zinc-950 font-mono text-[11px] text-zinc-100 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-emerald-400 select-none">$</span>
                  <span>npm install -g @anthropic-ai/claude-code</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-emerald-400 select-none">$</span>
                  <span>cd /path/to/your/project</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-emerald-400 select-none">$</span>
                  <span>claude</span>
                  <span className="text-zinc-500 ml-1"># first run prompts login</span>
                </div>
              </div>
            </div>

            {/* Codex CLI */}
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-hidden">
              <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
                <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">Codex CLI</span>
                <span className="text-[10px] text-zinc-400 ml-1.5">OpenAI</span>
              </div>
              <div className="p-2.5 rounded-b-lg bg-zinc-900 dark:bg-zinc-950 font-mono text-[11px] text-zinc-100 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-emerald-400 select-none">$</span>
                  <span>npm install -g @openai/codex</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-emerald-400 select-none">$</span>
                  <span>export OPENAI_API_KEY=&quot;your-api-key&quot;</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-emerald-400 select-none">$</span>
                  <span>cd /path/to/your/project</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-emerald-400 select-none">$</span>
                  <span>codex</span>
                  <span className="text-zinc-500 ml-1"># verify it works</span>
                </div>
              </div>
            </div>

            {/* Gemini CLI */}
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-hidden">
              <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
                <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">Gemini CLI</span>
                <span className="text-[10px] text-zinc-400 ml-1.5">Google</span>
              </div>
              <div className="p-2.5 rounded-b-lg bg-zinc-900 dark:bg-zinc-950 font-mono text-[11px] text-zinc-100 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-emerald-400 select-none">$</span>
                  <span>npm install -g @anthropic-ai/gemini-cli</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-emerald-400 select-none">$</span>
                  <span>cd /path/to/your/project</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-emerald-400 select-none">$</span>
                  <span>gemini</span>
                  <span className="text-zinc-500 ml-1"># first run prompts Google login</span>
                </div>
              </div>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mb-1 font-medium">
              Switching your AI tool later?
            </p>
            <p className="text-[10px] text-zinc-400 leading-relaxed">
              Re-run <code className="px-1 py-0.5 bg-zinc-200 dark:bg-zinc-800 rounded">specify init --here --integration {'<'}agent{'>'} --force</code> from
              your project folder to switch between Claude, Codex, or Gemini at any time.
            </p>
          </div>

          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
            Once your CLI works in the terminal, go to the <strong className="text-zinc-700 dark:text-zinc-300">Agents</strong> tab to
            set it as the active agent. Spec Rabbit will call this CLI to run
            workflow phases (specification, planning, implementation, etc.).
          </p>

          <button
            onClick={onGoToAgents}
            className="flex items-center gap-2 px-4 py-2 bg-black dark:bg-white text-white dark:text-black rounded-lg text-xs font-semibold hover:opacity-90 transition"
          >
            <Bot size={13} /> Go to Agents
            <ArrowRight size={12} />
          </button>
        </>
      )}
    </div>
  );
}

function CreateContent({
  blocked,
  onGoToRequirements,
  onDismiss,
}: {
  blocked: boolean;
  onGoToRequirements: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-zinc-900 dark:text-white">Start Building</h3>

      {blocked ? (
        <p className="text-xs text-zinc-400 dark:text-zinc-600 italic">
          Complete the previous steps first.
        </p>
      ) : (
        <>
          <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
            Your project is ready! Here's how to start building:
          </p>

          <div className="space-y-2.5">
            <div className="p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 hover:border-zinc-300 dark:hover:border-zinc-700 transition cursor-pointer"
              onClick={onDismiss}
            >
              <div className="flex items-center gap-2 mb-1">
                <FileText size={14} className="text-blue-500 shrink-0" />
                <span className="text-xs font-semibold text-zinc-900 dark:text-white">Create a feature</span>
              </div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 pl-[22px]">
                Type a feature name in the sidebar and hit +. Then run the Specification phase to
                generate a detailed spec from a brief description.
              </p>
            </div>

            <div className="p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 hover:border-zinc-300 dark:hover:border-zinc-700 transition cursor-pointer"
              onClick={onGoToRequirements}
            >
              <div className="flex items-center gap-2 mb-1">
                <Upload size={14} className="text-purple-500 shrink-0" />
                <span className="text-xs font-semibold text-zinc-900 dark:text-white">Import from a meeting or document</span>
              </div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 pl-[22px]">
                Go to Requirements to import a Zoom recording, transcript, or document.
                AI extracts requirements which you review and convert into features.
              </p>
            </div>
          </div>

          <div className="pt-2 flex gap-3">
            <button
              onClick={onDismiss}
              className="flex items-center gap-2 px-4 py-2 bg-black dark:bg-white text-white dark:text-black rounded-lg text-xs font-semibold hover:opacity-90 transition"
            >
              <Sparkles size={13} /> Start with a feature
            </button>
            <button
              onClick={onGoToRequirements}
              className="flex items-center gap-2 px-4 py-2 border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition"
            >
              <Upload size={13} /> Import requirements
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default GettingStartedGuide;
