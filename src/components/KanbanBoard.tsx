import React from 'react';
import { WorkflowState, FeatureWorkflow, WorkflowPhase, PhaseState, PersonaState, PersonaId, isPhaseDone } from '../domain/models/types';
import { Play, Check, RotateCcw, AlertTriangle, CheckCircle2, ChevronRight, Trash2, ShieldCheck, ChevronDown, ChevronUp, ShieldAlert, Info, X, MonitorPlay, Zap } from 'lucide-react';

type KanbanBoardProps = {
  state: WorkflowState;
  onRunPhase: (phase: WorkflowPhase, featureName: string | null) => void;
  onApprovePhase: (phase: WorkflowPhase, featureName: string | null) => void;
  onDiscardPhase: (phase: WorkflowPhase, featureName: string | null) => void;
  onSelectFeature: (name: string) => void;
  onDeleteFeature: (name: string) => void;
  onSelectPhaseFile: (filePath: string | null) => void;
  onCardDrop?: (featureName: string, targetColKey: string) => void;
  onRerunGate?: (featureName: string | null) => void;
  onOpenReview: (featureName: string, phaseState: PhaseState) => void;
  onStopPhase?: (phase: WorkflowPhase, featureName: string | null) => void;
  // Interactive phases (Clarify) never exit on their own: "Finish" sends them to review.
  onFinishPhase?: (phase: WorkflowPhase, featureName: string | null) => void;
  // Opens the running project (Preview tab) once implementation is done.
  onPreview?: (featureName: string) => void;
  // Re-runs a phase that stopped to ask something, with the user's answer.
  onAnswerPhase?: (phase: WorkflowPhase, featureName: string, answer: string) => void;
  // Specification card: approve the spec, skip to Implementation and build now.
  onQuickBuild?: (featureName: string) => void;
  // Fix & Retry: targeted fix for a failed review persona.
  onFixAndRetry?: (featureName: string, failedPersonaId: PersonaId, fixInstruction: string) => void;
};

// What "Yes, proceed" tells an agent that stopped to ask before building.
export const PROCEED_ANSWER =
  'Yes, proceed with the implementation now, even though some checklists are incomplete. Where the spec is unclear, follow the plan and contracts, and list those choices in your final report. Do not stop to ask again.';

const PERSONA_LABELS: Record<string, string> = {
  developer: 'Developer',
  qa: 'QA',
  'code-review': 'Code',
  security: 'Sec',
  'tech-lead': 'Lead',
};

const PERSONA_DESCRIPTIONS: Record<string, string> = {
  developer: 'Implements the features, writes source code, and completes specification tasks.',
  qa: 'Runs unit tests, lint checks and validates coverage requirements.',
  'code-review': 'Analyzes code complexity, patterns, and style conventions.',
  security: 'Inspects code for secret leaks, injection risks and path safety.',
  'tech-lead': 'Approves technical plan adherence and signs off execution.',
};

// Color classes per persona run status for the review-gate strip.
const personaChipClass = (status: PersonaState['status']): string => {
  switch (status) {
    case 'running':
      return 'text-blue-500 bg-blue-500/10 border-blue-500/20 animate-pulse';
    case 'passed':
      return 'text-green-500 bg-green-500/10 border-green-500/20';
    case 'failed':
      return 'text-red-500 bg-red-500/10 border-red-500/20';
    case 'unavailable':
      return 'text-amber-600 bg-amber-500/10 border-amber-500/20';
    default:
      return 'text-zinc-400 bg-zinc-100 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800';
  }
};

const PHASES: WorkflowPhase[] = [
  'specification',
  'clarification',
  'planning',
  'checklist',
  'analyze',
  'tasks',
  'taskstoissues',
  'implementation'
];
const COLUMN_HEADERS: Record<string, string> = {
  specification: 'Specification',
  clarification: 'Clarification',
  planning: 'Planning',
  checklist: 'Checklist',
  analyze: 'Analysis',
  tasks: 'Tasks',
  taskstoissues: 'Tasks to Issues',
  implementation: 'Implementation',
  completed: 'Completed'
};

export const KanbanBoard: React.FC<KanbanBoardProps> = ({
  state,
  onRunPhase,
  onApprovePhase,
  onDiscardPhase,
  onSelectFeature,
  onDeleteFeature,
  onSelectPhaseFile,
  onCardDrop,
  onRerunGate,
  onOpenReview,
  onStopPhase,
  onFinishPhase,
  onPreview,
  onAnswerPhase,
  onQuickBuild,
  onFixAndRetry
}) => {
  const [answers, setAnswers] = React.useState<Record<string, string>>({});
  const [fixInputs, setFixInputs] = React.useState<Record<string, string>>({});
  const [dragOverCol, setDragOverCol] = React.useState<string | null>(null);
  const [expandedGateFeature, setExpandedGateFeature] = React.useState<string | null>(null);

  const getDeveloperStatus = (activePhaseState: PhaseState): 'idle' | 'running' | 'passed' | 'failed' => {
    if (activePhaseState.status === 'idle') return 'idle';
    if (activePhaseState.status === 'running') {
      const hasGateStarted = activePhaseState.personas?.some(p => p.status !== 'idle');
      return hasGateStarted ? 'passed' : 'running';
    }
    return 'passed';
  };

  // The review gate stopped at a failing reviewer, or never started because a
  // reviewer isn't installed: the phase stays 'running' (blocked), but nothing
  // is executing. Returns that reviewer.
  const gateBlocker = (ps: PhaseState): PersonaState | null => {
    if (ps.phase !== 'implementation' || ps.status !== 'running' || !ps.personas) return null;
    if (ps.personas.some(p => p.status === 'running')) return null;
    return ps.personas.find(p => p.status === 'unavailable') ?? ps.personas.find(p => p.status === 'failed') ?? null;
  };
  const gateBlockedBy = (ps: PhaseState): string | null => {
    const blocker = gateBlocker(ps);
    return blocker ? PERSONA_LABELS[blocker.id] ?? blocker.id : null;
  };

  const isDeveloperPassedButGateIdle = (activePhaseState: PhaseState): boolean => {
    return getDeveloperStatus(activePhaseState) === 'passed' &&
      (!activePhaseState.personas || activePhaseState.personas.every(p => p.status === 'idle'));
  };

  const handleDragStart = (e: React.DragEvent, featureName: string) => {
    e.dataTransfer.setData('text/plain', featureName);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDragEnter = (e: React.DragEvent, colKey: string) => {
    e.preventDefault();
    setDragOverCol(colKey);
  };

  const handleDragLeave = () => {
    setDragOverCol(null);
  };

  const handleDrop = (e: React.DragEvent, colKey: string) => {
    e.preventDefault();
    setDragOverCol(null);
    const featureName = e.dataTransfer.getData('text/plain');
    if (featureName) {
      onCardDrop?.(featureName, colKey);
    }
  };
  
  // Helper to determine which column a feature belongs to
  const getFeatureColumn = (feature: FeatureWorkflow): string => {
    for (const phase of feature.phases) {
      if (!isPhaseDone(phase.status)) {
        return phase.phase;
      }
    }
    return 'completed';
  };

  // Helper to parse progress from tasks.md content
  const parseProgress = (feature: FeatureWorkflow) => {
    const tasksPhase = feature.phases.find(p => p.phase === 'tasks');
    if (!tasksPhase?.content) return null;
    const checkboxes = [...tasksPhase.content.matchAll(/^\s*(?:[-*]|\d+\.)\s+\[( |x|X)\]/gm)];
    if (checkboxes.length === 0) return null;
    const done = checkboxes.filter(c => c[1].toLowerCase() === 'x').length;
    return { done, total: checkboxes.length };
  };

  const getStatusBadge = (status: string, stale?: boolean) => {
    if (stale) {
      return (
        <span className="flex items-center gap-1 text-[10px] font-semibold text-red-500 bg-red-500/10 px-1.5 py-0.5 rounded border border-red-500/20">
          <AlertTriangle size={10} />
          STALE
        </span>
      );
    }
    switch (status) {
      case 'running':
        return (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-blue-500 bg-blue-500/10 px-1.5 py-0.5 rounded border border-blue-500/20 animate-pulse">
            RUNNING
          </span>
        );
      case 'awaiting_review':
        return (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
            REVIEW
          </span>
        );
      case 'approved':
        return (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-green-500 bg-green-500/10 px-1.5 py-0.5 rounded border border-green-500/20">
            APPROVED
          </span>
        );
      case 'skipped':
        return (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-zinc-500 bg-zinc-500/10 px-1.5 py-0.5 rounded border border-zinc-500/20" title="Skipped by a quick build — you can still run it">
            SKIPPED
          </span>
        );
      default:
        return (
          <span className="text-[10px] font-semibold text-zinc-400 bg-zinc-100 dark:bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-800">
            IDLE
          </span>
        );
    }
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-black overflow-y-auto">
      {/* Constitution Banner */}
      <div className="mx-6 my-4 p-4 border border-zinc-200 dark:border-zinc-800 rounded-lg bg-zinc-50 dark:bg-zinc-950 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Project Constitution</h2>
            {getStatusBadge(state.constitutionPhase.status, state.constitutionPhase.stale)}
          </div>
          <p className="text-xs text-zinc-500 mt-1">
            Governing principles and rules that guide all subsequent planning and implementation.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onSelectPhaseFile(state.constitutionPhase.filePath)}
            disabled={!state.constitutionPhase.filePath}
            className="px-3 py-1.5 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded text-xs transition disabled:opacity-50"
          >
            View Constitution
          </button>
          {state.constitutionPhase.status !== 'approved' ? (
            <>
              <button
                onClick={() => onRunPhase('constitution', null)}
                disabled={state.constitutionPhase.status === 'running'}
                className="flex items-center gap-1 px-3 py-1.5 bg-black dark:bg-white text-white dark:text-black rounded text-xs font-semibold hover:opacity-90 transition disabled:opacity-50"
              >
                <Play size={10} fill="currentColor" /> Run
              </button>
              {state.constitutionPhase.status === 'awaiting_review' && (
                <button
                  onClick={() => onApprovePhase('constitution', null)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-green-650 hover:bg-green-700 text-white rounded text-xs font-semibold transition"
                >
                  <Check size={10} /> Approve
                </button>
              )}
            </>
          ) : (
            <button
              onClick={() => onDiscardPhase('constitution', null)}
              className="flex items-center gap-1 px-3 py-1.5 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded text-xs transition"
            >
              <RotateCcw size={10} /> Discard
            </button>
          )}
        </div>
      </div>

      {/* Columns wrapper */}
      <div className="flex-1 flex gap-4 px-6 pb-6 overflow-x-auto min-h-0">
        {(['specification', 'clarification', 'planning', 'checklist', 'analyze', 'tasks', 'taskstoissues', 'implementation', 'completed'] as const).map(colKey => {
          const colFeatures = state.features.filter(f => getFeatureColumn(f) === colKey);
          
          return (
            <div
              key={colKey}
              onDragOver={handleDragOver}
              onDragEnter={(e) => handleDragEnter(e, colKey)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, colKey)}
              className={`flex flex-col flex-shrink-0 w-72 h-full border rounded-lg overflow-hidden transition-all duration-200 ${
                dragOverCol === colKey
                  ? 'border-dashed border-zinc-400 dark:border-zinc-500 bg-zinc-100/70 dark:bg-zinc-900/40 ring-1 ring-zinc-400 dark:ring-zinc-500'
                  : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/20'
              }`}
            >
              {/* Header */}
              <div className="flex justify-between items-center px-3.5 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-950/70">
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                  {COLUMN_HEADERS[colKey]}
                </span>
                <span className="text-xs text-zinc-400 bg-zinc-200 dark:bg-zinc-900 px-1.5 py-0.5 rounded-full font-semibold">
                  {colFeatures.length}
                </span>
              </div>

              {/* Cards area */}
              <div className="flex-1 p-3 overflow-y-auto space-y-3" style={{ scrollbarWidth: 'thin' }}>
                {colFeatures.length === 0 ? (
                  <div className="flex items-center justify-center h-24 border border-dashed border-zinc-200 dark:border-zinc-800 rounded bg-white dark:bg-black/10 text-xs text-zinc-400">
                    No features in this phase
                  </div>
                ) : (
                  colFeatures.map(feature => {
                    const progress = parseProgress(feature);
                    const activePhaseState = colKey === 'completed'
                      ? feature.phases[feature.phases.length - 1]
                      : feature.phases.find(p => p.phase === colKey)!;
                    
                    const isActive = state.activeFeatureName === feature.name;

                    return (
                      <div
                        key={feature.name}
                        draggable
                        onDragStart={(e) => handleDragStart(e, feature.name)}
                        onClick={() => onSelectFeature(feature.name)}
                        className={`p-3.5 border rounded-lg bg-white dark:bg-black transition-all cursor-pointer group flex flex-col justify-between hover:shadow-sm active:scale-[0.98] ${
                          isActive
                            ? 'border-black dark:border-white ring-1 ring-black dark:ring-white shadow-sm'
                            : 'border-zinc-200 dark:border-zinc-850 hover:border-zinc-350 dark:hover:border-zinc-700'
                        }`}
                      >
                        <div>
                          <div className="flex justify-between items-start gap-2">
                            <span className="text-xs font-bold text-zinc-850 dark:text-zinc-100 truncate group-hover:text-black dark:group-hover:text-white">
                              {feature.name}
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteFeature(feature.name);
                              }}
                              className="text-zinc-400 hover:text-red-500 p-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded opacity-0 group-hover:opacity-100 transition"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>

                          {/* Action area based on status */}
                          {colKey !== 'completed' && (
                            <div className="flex justify-between items-center mt-3">
                              {gateBlocker(activePhaseState)?.status === 'unavailable' ? (
                                <span
                                  className="flex items-center gap-1 text-[10px] font-semibold text-amber-600 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20"
                                  title={gateBlocker(activePhaseState)?.note ?? 'A reviewer is not installed in this workspace.'}
                                >
                                  <AlertTriangle size={10} />
                                  BLOCKED · {gateBlockedBy(activePhaseState)} NOT INSTALLED
                                </span>
                              ) : gateBlockedBy(activePhaseState) ? (
                                <span
                                  className="flex items-center gap-1 text-[10px] font-semibold text-red-500 bg-red-500/10 px-1.5 py-0.5 rounded border border-red-500/20"
                                  title="A reviewer failed the implementation. Read its report, fix the problems, then re-run the review."
                                >
                                  <AlertTriangle size={10} />
                                  BLOCKED · {gateBlockedBy(activePhaseState)}
                                </span>
                              ) : getStatusBadge(activePhaseState.status, activePhaseState.stale)}
                              {colKey === 'implementation' && activePhaseState.quickBuild && (
                                <span className="text-[9px] font-semibold text-zinc-500 flex items-center gap-0.5" title="Built from the spec with Quick build"><Zap size={9} /> QUICK BUILD</span>
                              )}

                              {progress && (
                                <span className="text-[10px] font-mono text-zinc-400 bg-zinc-100 dark:bg-zinc-900 px-1 py-0.5 rounded">
                                  {progress.done}/{progress.total} Tasks
                                </span>
                              )}
                            </div>
                          )}

                          {/* Implementation review gate: persona sub-agent statuses */}
                          {(colKey === 'implementation' || colKey === 'completed') && (
                            <div className="mt-3">
                              {/* Summary chips row */}
                              <div className="flex items-center gap-1 flex-wrap">
                                <ShieldCheck size={11} className="text-zinc-400" />
                                <span
                                  title={`developer: ${getDeveloperStatus(activePhaseState)}`}
                                  className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border ${personaChipClass(getDeveloperStatus(activePhaseState))}`}
                                >
                                  Dev
                                </span>
                                {activePhaseState.personas && activePhaseState.personas.length > 0 && (
                                  <>
                                    <ChevronRight size={9} className="text-zinc-300 dark:text-zinc-700" />
                                    {activePhaseState.personas.map((p, i) => (
                                      <React.Fragment key={p.id}>
                                        {i > 0 && <ChevronRight size={9} className="text-zinc-300 dark:text-zinc-700" />}
                                        <span
                                          title={`${p.id}: ${p.status}`}
                                          className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border ${personaChipClass(p.status)}`}
                                        >
                                          {PERSONA_LABELS[p.id] || p.id}
                                        </span>
                                      </React.Fragment>
                                    ))}
                                  </>
                                )}
                              </div>

                              {/* Toggle Gate details button */}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedGateFeature(expandedGateFeature === feature.name ? null : feature.name);
                                }}
                                className="w-full text-[10px] flex items-center justify-between text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 mt-2 px-2 py-1 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/30 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition"
                              >
                                <div className="flex items-center gap-1">
                                  <ShieldCheck size={11} className="text-zinc-400" />
                                  <span className="font-semibold">Review Gate Dashboard</span>
                                </div>
                                {expandedGateFeature === feature.name ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                              </button>

                              {/* Expanded details container */}
                              {expandedGateFeature === feature.name && (
                                <div
                                  className="mt-2.5 p-2.5 rounded-md border border-zinc-150 dark:border-zinc-850 bg-zinc-50/20 dark:bg-zinc-950/20 space-y-2.5"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {/* List of personas */}
                                  <div className="space-y-2">
                                    {['developer', 'qa', 'code-review', 'security', 'tech-lead'].map(id => {
                                      let status: PersonaState['status'] = 'idle';
                                      let reportPath: string | null = null;
                                      let label = '';
                                      let note: string | undefined;

                                      if (id === 'developer') {
                                        status = getDeveloperStatus(activePhaseState);
                                        reportPath = activePhaseState.filePath;
                                        label = 'Developer';
                                      } else {
                                        const personaState = activePhaseState.personas?.find(p => p.id === id) || { id, status: 'idle', reportPath: null };
                                        status = personaState.status;
                                        reportPath = personaState.reportPath ?? null;
                                        note = 'note' in personaState ? personaState.note : undefined;
                                        label = id === 'qa' ? 'QA Agent' : id === 'code-review' ? 'Code Reviewer' : id === 'security' ? 'Security Auditor' : 'Tech Lead';
                                      }

                                      return (
                                        <div
                                          key={id}
                                          className={`p-2 rounded-md border transition flex flex-col gap-1.5 ${
                                            status === 'passed'
                                              ? 'bg-green-500/5 border-green-500/20 dark:border-green-500/10'
                                              : status === 'failed'
                                              ? 'bg-red-500/5 border-red-500/20 dark:border-red-500/10'
                                              : status === 'unavailable'
                                              ? 'bg-amber-500/5 border-amber-500/20 dark:border-amber-500/10'
                                              : status === 'running'
                                              ? 'bg-blue-500/5 border-blue-500/20 dark:border-blue-500/10 animate-pulse'
                                              : 'bg-white dark:bg-black border-zinc-200 dark:border-zinc-850'
                                          }`}
                                        >
                                          <div className="flex justify-between items-start">
                                            <div>
                                              <div className="flex items-center gap-1.5">
                                                <span className="text-[10px] font-bold text-zinc-700 dark:text-zinc-300">
                                                  {label}
                                                </span>
                                                <span className={`w-1.5 h-1.5 rounded-full ${
                                                  status === 'passed'
                                                    ? 'bg-green-500'
                                                    : status === 'failed'
                                                    ? 'bg-red-500'
                                                    : status === 'unavailable'
                                                    ? 'bg-amber-500'
                                                    : status === 'running'
                                                    ? 'bg-blue-500 animate-ping'
                                                    : 'bg-zinc-300 dark:bg-zinc-700'
                                                }`} />
                                              </div>
                                              <p className="text-[9px] text-zinc-400 dark:text-zinc-500 mt-0.5 leading-normal">
                                                {PERSONA_DESCRIPTIONS[id]}
                                              </p>
                                              {note && <p className={`text-[9px] mt-0.5 leading-normal ${status === 'unavailable' ? 'text-amber-700 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>{note}</p>}
                                            </div>

                                            <div className="flex items-center gap-1 shrink-0">
                                              {id === 'developer' && status === 'idle' && (
                                                <button
                                                  onClick={() => onRunPhase('implementation', feature.name)}
                                                  className="text-[9px] font-semibold text-white bg-black dark:bg-white dark:text-black px-1.5 py-0.5 rounded transition hover:opacity-90 flex items-center gap-1 shrink-0"
                                                >
                                                  <Play size={8} fill="currentColor" /> Code
                                                </button>
                                              )}

                                              {status === 'running' && (
                                                <button
                                                  onClick={() => onStopPhase?.('implementation', feature.name)}
                                                  className="text-[9px] font-semibold text-white bg-red-600 hover:bg-red-700 px-1.5 py-0.5 rounded transition flex items-center gap-1 shrink-0"
                                                  title="Stop execution of this agent persona"
                                                >
                                                  <X size={8} /> Stop
                                                </button>
                                              )}

                                              {reportPath ? (
                                                <button
                                                  onClick={() => onSelectPhaseFile(reportPath!)}
                                                  className="text-[9px] font-semibold text-blue-500 dark:text-blue-400 hover:underline px-1.5 py-0.5 border border-blue-500/10 hover:border-blue-500/20 bg-blue-500/5 rounded transition shrink-0"
                                                >
                                                  Report
                                                </button>
                                              ) : (
                                                id !== 'developer' && status !== 'running' && status !== 'unavailable' && <span className="text-[9px] text-zinc-400 italic shrink-0">No report</span>
                                              )}
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>

                                  {/* Warning if Developer finished coding but review gate has not been started yet */}
                                  {isDeveloperPassedButGateIdle(activePhaseState) && (
                                    <div className="p-2 border border-blue-500/20 bg-blue-500/5 text-blue-500 dark:text-blue-400 rounded-md text-[9px] leading-normal flex items-start gap-1">
                                      <Info size={11} className="mt-0.5 shrink-0" />
                                      <span>
                                        Developer finished coding. Trigger the <strong>Review Gate</strong> to verify implementation.
                                      </span>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Fix Mode: shown when a review persona failed the gate */}
                        {gateBlocker(activePhaseState)?.status === 'failed' && onFixAndRetry && (
                          <div className="mt-3 p-2.5 rounded-md border border-red-500/20 bg-red-500/5 text-[10px] leading-normal space-y-2" onClick={e => e.stopPropagation()}>
                            {gateBlocker(activePhaseState)?.failureSummary && (
                              <p className="text-red-700 dark:text-red-300 font-medium line-clamp-3">
                                <ShieldAlert size={10} className="inline mr-1 -mt-px" />
                                {gateBlocker(activePhaseState)!.failureSummary}
                              </p>
                            )}
                            {gateBlocker(activePhaseState)?.suggestedFix && (
                              <button
                                onClick={() => onFixAndRetry(feature.name, gateBlocker(activePhaseState)!.id, gateBlocker(activePhaseState)!.suggestedFix!)}
                                className="w-full text-left px-2 py-1.5 rounded bg-black dark:bg-white text-white dark:text-black font-semibold text-[10px] hover:opacity-90 transition"
                              >
                                Apply Suggested Fix: {gateBlocker(activePhaseState)!.suggestedFix}
                              </button>
                            )}
                            <div className="flex items-center gap-1">
                              <input
                                value={fixInputs[feature.name] ?? ''}
                                onChange={e => setFixInputs(fi => ({ ...fi, [feature.name]: e.target.value }))}
                                placeholder="Or describe a custom fix…"
                                aria-label="Custom fix instruction"
                                className="flex-1 min-w-[90px] px-1.5 py-1 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950"
                              />
                              <button
                                onClick={() => {
                                  const instruction = (fixInputs[feature.name] ?? '').trim();
                                  if (instruction) {
                                    onFixAndRetry(feature.name, gateBlocker(activePhaseState)!.id, instruction);
                                    setFixInputs(fi => ({ ...fi, [feature.name]: '' }));
                                  }
                                }}
                                disabled={!(fixInputs[feature.name] ?? '').trim()}
                                className="px-2 py-1 rounded bg-black dark:bg-white text-white dark:text-black font-semibold disabled:opacity-40 transition"
                              >
                                Fix &amp; Retry
                              </button>
                            </div>
                          </div>
                        )}

                        {/* The last run stopped and needs the user (e.g. Implement asked a question) */}
                        {activePhaseState.attention && (
                          <div className="mt-3 p-2 rounded-md border border-amber-500/30 bg-amber-500/10 text-[10px] leading-normal space-y-1.5" onClick={e => e.stopPropagation()}>
                            <p className="font-semibold text-amber-800 dark:text-amber-300 flex items-start gap-1"><AlertTriangle size={11} className="mt-px shrink-0" /> {activePhaseState.attention.message}</p>
                            {activePhaseState.attention.question && (
                              <p className="text-zinc-700 dark:text-zinc-300">The agent asked: <em>{activePhaseState.attention.question}</em></p>
                            )}
                            {onAnswerPhase && (
                              <div className="flex flex-wrap items-center gap-1">
                                {colKey === 'implementation' && (
                                  <button
                                    onClick={() => onAnswerPhase(colKey, feature.name, PROCEED_ANSWER)}
                                    className="px-2 py-0.5 rounded bg-black dark:bg-white text-white dark:text-black font-semibold"
                                  >
                                    Yes, proceed
                                  </button>
                                )}
                                <input
                                  value={answers[feature.name] ?? ''}
                                  onChange={e => setAnswers(a => ({ ...a, [feature.name]: e.target.value }))}
                                  placeholder="Or type your answer…"
                                  aria-label="Your answer to the agent"
                                  className="flex-1 min-w-[90px] px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950"
                                />
                                <button
                                  onClick={() => { const a = (answers[feature.name] ?? '').trim(); if (a && colKey !== 'completed') { onAnswerPhase(colKey, feature.name, a); setAnswers(x => ({ ...x, [feature.name]: '' })); } }}
                                  disabled={!(answers[feature.name] ?? '').trim()}
                                  className="px-2 py-0.5 rounded border border-zinc-200 dark:border-zinc-800 font-semibold disabled:opacity-40"
                                >
                                  Send
                                </button>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Interactive Phase Control buttons on cards */}
                        <div className="mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-900 flex justify-end items-center gap-1.5">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectPhaseFile(activePhaseState.filePath);
                            }}
                            disabled={!activePhaseState.filePath}
                            className="mr-auto text-[10px] hover:underline text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 disabled:opacity-0"
                          >
                            Open File
                          </button>

                          {onPreview && (colKey === 'completed' || (colKey === 'implementation' && ['awaiting_review', 'approved'].includes(activePhaseState.status))) && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onPreview(feature.name);
                              }}
                              title="Run the project and see the changes"
                              className="flex items-center gap-0.5 p-1 px-2 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-[10px] font-semibold rounded transition"
                            >
                              <MonitorPlay size={9} /> Preview
                            </button>
                          )}

                          {colKey !== 'completed' ? (
                            activePhaseState.status !== 'approved' ? (
                              <>
                                {gateBlockedBy(activePhaseState) && onRerunGate && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onRerunGate(feature.name);
                                    }}
                                    title="Run the reviewers again, without re-running the implementation"
                                    className="flex items-center gap-0.5 p-1 px-2 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-[10px] font-semibold rounded transition"
                                  >
                                    <ShieldCheck size={8} /> Re-run review
                                  </button>
                                )}
                                {colKey === 'clarification' && activePhaseState.status === 'running' && onFinishPhase && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onFinishPhase(colKey, feature.name);
                                    }}
                                    title="Clarify waits for more input after it finishes. Close the session and review spec.md."
                                    className="flex items-center gap-0.5 p-1 px-2 bg-black dark:bg-white text-white dark:text-black hover:opacity-90 text-[10px] font-semibold rounded transition"
                                  >
                                    <Check size={8} /> Finish
                                  </button>
                                )}
                                {activePhaseState.status === 'running' && !gateBlockedBy(activePhaseState) ? (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onStopPhase?.(colKey, feature.name);
                                    }}
                                    className="flex items-center gap-0.5 p-1 px-2 bg-red-600 hover:bg-red-700 text-white text-[10px] font-semibold rounded transition"
                                  >
                                    <X size={8} /> Stop
                                  </button>
                                ) : (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onRunPhase(colKey, feature.name);
                                    }}
                                    className="flex items-center gap-0.5 p-1 px-2 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-[10px] font-semibold rounded transition"
                                  >
                                    <Play size={8} fill="currentColor" /> Run
                                  </button>
                                )}

                                {colKey === 'implementation' && (
                                   <button
                                     onClick={(e) => {
                                       e.stopPropagation();
                                       onOpenReview(feature.name, activePhaseState);
                                     }}
                                     disabled={activePhaseState.status === 'running' && !gateBlockedBy(activePhaseState)}
                                     title="Open the human developer audit portal"
                                     className="flex items-center gap-0.5 p-1 px-2 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-[10px] font-semibold rounded transition disabled:opacity-50"
                                   >
                                     <ShieldCheck size={8} /> Review
                                   </button>
                                 )}

                                {colKey === 'specification' && activePhaseState.status === 'awaiting_review' && onQuickBuild && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onQuickBuild(feature.name);
                                    }}
                                    title="Approve this spec and build it now. Clarification to Tasks are skipped; your agent works out the plan and tasks from the spec and the existing code, and records its assumptions in tasks.md."
                                    className="flex items-center gap-0.5 p-1 px-2 bg-black dark:bg-white text-white dark:text-black hover:opacity-90 text-[10px] font-semibold rounded transition"
                                  >
                                    <Zap size={8} fill="currentColor" /> Quick build
                                  </button>
                                )}

                                {activePhaseState.status === 'awaiting_review' && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onApprovePhase(colKey, feature.name);
                                    }}
                                    className="flex items-center gap-0.5 p-1 px-2 bg-green-500 hover:bg-green-600 text-white text-[10px] font-semibold rounded transition"
                                  >
                                    <Check size={8} /> Approve
                                  </button>
                                )}
                              </>
                            ) : (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onDiscardPhase(colKey, feature.name);
                                }}
                                className="flex items-center gap-0.5 p-1 px-2 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-[10px] font-semibold rounded text-zinc-500 hover:text-zinc-700 transition"
                              >
                                <RotateCcw size={8} /> Reset
                              </button>
                            )
                          ) : (
                            <span className="flex items-center gap-0.5 text-green-500 font-bold text-[10px] uppercase">
                              <CheckCircle2 size={10} /> Complete
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
export default KanbanBoard;
