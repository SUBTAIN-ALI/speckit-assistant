'use client';

import React, { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';

const TerminalPanel = dynamic(() => import('@/components/TerminalPanel'), {
  ssr: false,
});

import {
  WorkflowPhase,
  AgentConfig,
  AgentType,
  PhaseStatus,
  PhaseState,
  isPhaseDone,
} from '@/domain/models/types';
import KanbanBoard from '@/components/KanbanBoard';
import DagMap from '@/components/DagMap';
import MarkdownEditor from '@/components/MarkdownEditor';
import AgentConsole, { type AgentConsoleHandle } from '@/components/AgentConsole';
import { PersonaEditorModal } from '@/components/PersonaEditorModal';
import { HumanReviewModal } from '@/components/HumanReviewModal';
import AgentsPanel from '@/components/AgentsPanel';
import McpPanel from '@/components/McpPanel';
import ExtensionsPanel from '@/components/ExtensionsPanel';
import AboutModal, { APP_VERSION } from '@/components/AboutModal';
import ExpertiseAssessmentModal from '@/components/ExpertiseAssessmentModal';
import ChromeExtensionGuideModal from '@/components/ChromeExtensionGuideModal';
import GitCommitModal from '@/components/GitCommitModal';
import { BrowserTestStatus, BrowserTestResult } from '@/domain/models/browserTest';
import ExecutionsView from '@/components/ExecutionsView';
import RequirementsSection from '@/components/RequirementsSection';
import WorkspaceSwitcher from '@/components/WorkspaceSwitcher';
import PreviewPanel from '@/components/PreviewPanel';
import ChatPanel from '@/chatbot/components/ChatPanel';
import { activeAgent } from '@/domain/models/agents';
import {
  Sun,
  Moon,
  Plus,
  Play,
  LayoutGrid,
  GitFork,
  X,
  ChevronRight,
  ChevronLeft,
  Folder,
  Sparkles,
  Maximize2,
  Minimize2,
  ShieldCheck,
  Bot,
  Plug,
  Package,
  Activity,
  ClipboardList,
  MessageSquare
} from 'lucide-react';

import { useDarkMode } from './hooks/useDarkMode';
import { useSidebar } from './hooks/useSidebar';
import { useWorkflowState } from './hooks/useWorkflowState';
import { usePhaseRunner } from './hooks/usePhaseRunner';
import { useConfigStore } from './hooks/useConfigStore';

export default function Dashboard() {
  const agentConsoleRef = React.useRef<AgentConsoleHandle | null>(null);

  const [viewMode, setViewMode] = useState<'kanban' | 'dag' | 'executions'>('kanban');
  const [section, setSection] = useState<'workflow' | 'requirements' | 'agents' | 'mcp' | 'extensions'>('workflow');
  const [activeTab, setActiveTab] = useState<'editor' | 'console' | 'terminal' | 'preview'>('editor');
  const [chatOpen, setChatOpen] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [isEditorMaximized, setIsEditorMaximized] = useState(false);
  const [auditingFeature, setAuditingFeature] = useState<{ name: string; phaseState: PhaseState } | null>(null);
  const [browserTestFeature, setBrowserTestFeature] = useState<string | null>(null);
  const [commitFeature, setCommitFeature] = useState<string | null>(null);
  const [browserTestStatus, setBrowserTestStatus] = useState<BrowserTestStatus | null>(null);
  const [browserTestResult, setBrowserTestResult] = useState<BrowserTestResult | null>(null);

  const { theme, handleToggleTheme } = useDarkMode();
  const { isSidebarCollapsed, handleToggleSidebar } = useSidebar();

  const configStore = useConfigStore({ agentConsoleRef });

  const workflow = useWorkflowState(configStore.fetchExecutions);

  // Deep link: navigate to section from URL params (e.g. ?section=requirements).
  useEffect(() => {
    if (workflow.deepLinkSection === 'requirements') setSection('requirements');
  }, [workflow.deepLinkSection]);

  const phaseRunner = usePhaseRunner({
    agentConsoleRef,
    state: workflow.state,
    agentConfig: configStore.agentConfig,
    personaConfigs: configStore.personaConfigs,
    handleLoadFile: workflow.handleLoadFile,
    handleSelectFeature: workflow.handleSelectFeature,
    setState: workflow.setState,
    fetchState: workflow.fetchState,
  });

  // Wire activeTab to 'console' when a phase starts running.
  const prevRunning = useRef(phaseRunner.running);
  useEffect(() => {
    if (phaseRunner.running && !prevRunning.current) {
      setActiveTab('console');
    }
    prevRunning.current = phaseRunner.running;
  }, [phaseRunner.running]);

  const handleBrowserTest = async (serverUrl: string) => {
    if (!browserTestFeature) return;
    setBrowserTestStatus('checking-chrome');
    setBrowserTestResult(null);
    try {
      const res = await fetch('/api/browser-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          featureName: browserTestFeature,
          agentConfig: configStore.agentConfig,
          config: { serverUrl },
        }),
      });
      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value);
        const messages = buffer.split('\n\n');
        buffer = messages.pop() || '';
        for (const msg of messages) {
          const dataLine = msg.split('\n').find(l => l.startsWith('data: '));
          if (!dataLine) continue;
          const parsed = JSON.parse(dataLine.substring(6));
          if (msg.startsWith('event: status')) {
            setBrowserTestStatus(parsed.status);
          } else if (msg.startsWith('event: done')) {
            setBrowserTestResult(parsed);
            setBrowserTestStatus(parsed.status);
          } else if (msg.startsWith('event: error')) {
            setBrowserTestResult({ featureName: browserTestFeature, status: 'failed', startedAt: Date.now(), serverUrl, criteria: [], summary: parsed.message });
            setBrowserTestStatus('failed');
          }
        }
      }
    } catch (err) {
      console.error('Browser test failed:', err);
      setBrowserTestStatus('failed');
    }
  };

  const handleCardDrop = async (featureName: string, targetColKey: string) => {
    if (!workflow.state) return;
    const feature = workflow.state.features.find(f => f.name === featureName);
    if (!feature) return;

    const phasesOrder: WorkflowPhase[] = [
      'specification',
      'clarification',
      'planning',
      'checklist',
      'tasks',
      'analyze',
      'taskstoissues',
      'implementation'
    ];

    const getActivePhase = (): WorkflowPhase | 'completed' => {
      for (const p of feature.phases) {
        if (!isPhaseDone(p.status)) return p.phase;
      }
      return 'completed';
    };

    const currentPhase = getActivePhase();
    if (currentPhase === targetColKey) return;

    const currentIndex = currentPhase === 'completed' ? phasesOrder.length : phasesOrder.indexOf(currentPhase);
    const targetIndex = targetColKey === 'completed' ? phasesOrder.length : phasesOrder.indexOf(targetColKey as WorkflowPhase);

    if (workflow.state.activeFeatureName !== featureName) {
      await workflow.handleSelectFeature(featureName);
    }

    if (targetIndex > currentIndex) {
      for (let i = currentIndex; i < targetIndex; i++) {
        const phaseToApprove = phasesOrder[i];
        const res = await fetch('/api/phase', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'approve',
            phase: phaseToApprove,
            featureName
          })
        });
        const updatedState = await res.json();
        workflow.setState(updatedState);
      }

      if (targetColKey !== 'completed') {
        const targetPhase = targetColKey as WorkflowPhase;
        phaseRunner.handleRunPhase(targetPhase, featureName);
      }
    } else {
      const targetPhase = targetColKey as WorkflowPhase;
      const res = await fetch('/api/phase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'discard',
          phase: targetPhase,
          featureName
        })
      });
      const updatedState = await res.json();
      workflow.setState(updatedState);

      if (workflow.selectedFile?.path && workflow.selectedFile.path.includes(targetPhase)) {
        workflow.setSelectedFile(null);
      }
    }
  };

  const handleRunDevOpsWithTab = async (agentId: string) => {
    setActiveTab('console');
    await configStore.handleRunDevOps(agentId, workflow.state?.activeFeatureName || null);
  };

  const activeExec = phaseRunner.getActivePhaseForExecution();

  return (
    <div className="flex flex-col h-dvh bg-white dark:bg-black text-zinc-900 dark:text-zinc-50 overflow-hidden font-sans">

      {/* Top Header Navigation */}
      <header className="flex justify-between items-center px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-black z-10 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-xl">🌱</span>
          <div>
            <div className="flex items-center gap-1.5">
              <h1 className="text-sm font-bold tracking-tight">Spec Rabbit</h1>
              <button
                onClick={() => setShowAbout(true)}
                className="text-[9px] font-mono text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 border border-zinc-200 dark:border-zinc-800 rounded px-1 py-0.5 leading-none transition"
                title="About"
              >
                v{APP_VERSION}
              </button>
            </div>
            <WorkspaceSwitcher busy={phaseRunner.running || configStore.runningDevOps !== null} />
          </div>
        </div>

        {/* Top Control Bar */}
        <div className="flex items-center gap-3">
          {/* Section Selector */}
          <div className="flex items-center bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-0.5">
            {([
              { id: 'workflow', label: 'Workflow', icon: <LayoutGrid size={13} /> },
              { id: 'requirements', label: 'Requirements', icon: <ClipboardList size={13} /> },
              { id: 'agents', label: 'Agents', icon: <Bot size={13} /> },
              { id: 'mcp', label: 'MCP Tools', icon: <Plug size={13} /> },
              { id: 'extensions', label: 'Extensions', icon: <Package size={13} /> },
            ] as const).map(s => (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                className={`px-2.5 py-1.5 rounded-md transition text-xs flex items-center gap-1.5 font-semibold ${section === s.id ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 shadow-sm' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'}`}
              >
                {s.icon}
                <span>{s.label}</span>
              </button>
            ))}
          </div>

          {section === 'workflow' && (
            <>
              {/* Mode Selector */}
              <div className="flex items-center bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-0.5">
                <button
                  onClick={() => setViewMode('kanban')}
                  className={`p-1.5 rounded-md transition text-xs flex items-center gap-1.5 ${viewMode === 'kanban' ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 shadow-sm' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'}`}
                >
                  <LayoutGrid size={13} />
                  <span>Kanban</span>
                </button>
                <button
                  onClick={() => setViewMode('dag')}
                  className={`p-1.5 rounded-md transition text-xs flex items-center gap-1.5 ${viewMode === 'dag' ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 shadow-sm' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'}`}
                >
                  <GitFork size={13} />
                  <span>DAG Map</span>
                </button>
                <button
                  onClick={() => setViewMode('executions')}
                  className={`p-1.5 rounded-md transition text-xs flex items-center gap-1.5 ${viewMode === 'executions' ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 shadow-sm' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'}`}
                >
                  <Activity size={13} />
                  <span>Executions</span>
                </button>
              </div>

              {/* Review Portal / Audit Trigger */}
              <button
                onClick={() => {
                  const activeFeatureName = workflow.state?.activeFeatureName;
                  const activeFeature = workflow.state?.features.find(f => f.name === activeFeatureName);
                  const implPhase = activeFeature?.phases.find(p => p.phase === 'implementation') || {
                    phase: 'implementation',
                    status: 'idle',
                    filePath: null,
                    content: null
                  };
                  setAuditingFeature({
                    name: activeFeatureName || 'Workspace',
                    phaseState: implPhase
                  });
                }}
                className="p-2 border border-zinc-200 dark:border-zinc-800 rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition hover:bg-zinc-100 dark:hover:bg-zinc-900 flex items-center gap-1.5 text-xs font-semibold"
                title="Open Human Review Portal"
              >
                <ShieldCheck size={14} className="text-blue-500" />
                <span className="hidden sm:inline">Review Portal</span>
              </button>
            </>
          )}

          {/* Expertise Profile Badge */}
          <button
            onClick={() => workflow.setShowExpertiseAssessment(true)}
            className="flex items-center gap-1.5 px-2 py-1.5 border border-zinc-200 dark:border-zinc-800 rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition hover:bg-zinc-100 dark:hover:bg-zinc-900 text-[11px]"
            title="Change expertise profile"
          >
            <span className={`w-2 h-2 rounded-full ${
              !workflow.state?.expertiseProfile || workflow.state.expertiseProfile.mode === 'power-user' ? 'bg-green-500' :
              workflow.state.expertiseProfile.mode === 'domain-transfer' ? 'bg-blue-500' :
              workflow.state.expertiseProfile.mode === 'tech-shield' ? 'bg-amber-500' : 'bg-purple-500'
            }`} />
            <span className="hidden sm:inline font-medium">
              {!workflow.state?.expertiseProfile ? 'Set Profile' :
                workflow.state.expertiseProfile.mode === 'power-user' ? 'Power User' :
                workflow.state.expertiseProfile.mode === 'domain-transfer' ? 'Domain Transfer' :
                workflow.state.expertiseProfile.mode === 'tech-shield' ? 'Business-Friendly' : 'Full Guidance'}
            </span>
          </button>

          {/* Theme Switcher */}
          <button
            onClick={handleToggleTheme}
            className="p-2 border border-zinc-200 dark:border-zinc-800 rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            {theme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
          </button>
        </div>
      </header>

      {/* Main body split container */}
      <div className="flex-1 flex overflow-hidden min-h-0">

        {section === 'agents' && (
          <AgentsPanel
            agentsFile={configStore.agentsFile}
            mcpServers={configStore.mcpFile.servers}
            personaConfigs={configStore.personaConfigs}
            specAgentsFile={configStore.specAgentsFile}
            devopsAgentsFile={configStore.devopsAgentsFile}
            onSaveAgents={configStore.handleSaveAgents}
            onSavePersonas={configStore.handleSavePersonasList}
            onSaveSpecAgents={configStore.handleSaveSpecAgents}
            onSaveDevOpsAgents={configStore.handleSaveDevOpsAgents}
            onEditPersona={configStore.setEditingPersona}
            onApply={configStore.handleApplyMcp}
            onApplySpecAgents={configStore.handleApplySpecAgents}
          />
        )}

        {section === 'requirements' && (
          <RequirementsSection
            agentConfig={configStore.agentConfig}
            agentLabel={activeAgent(configStore.agentsFile)?.name ?? configStore.agentConfig.agentType}
            onStateChange={workflow.setState}
            onNavigate={setSection}
            onOpenFeature={async (name) => {
              await workflow.fetchState();
              setSection('workflow');
              await workflow.handleSelectFeature(name);
            }}
          />
        )}

        {section === 'mcp' && (
          <McpPanel mcpFile={configStore.mcpFile} onSave={configStore.handleSaveMcp} />
        )}

        {section === 'extensions' && (
          <ExtensionsPanel
            available={configStore.extState.available}
            installed={configStore.extState.installed}
            bundled={configStore.extState.bundled}
            onAction={configStore.handleExtensionAction}
          />
        )}

        {/* Kept mounted while another section is open, so a running agent's
            live console (and its scrollback) keeps receiving output. */}
        <div className={section === 'workflow' ? 'contents' : 'hidden'}>
        {/* Left Sidebar: Feature Manager */}
        <aside className={`border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/20 flex flex-col shrink-0 transition-all duration-300 ${isSidebarCollapsed ? 'w-12 items-center justify-between py-4' : 'w-64'}`}>
          {isSidebarCollapsed ? (
            <>
              {/* Collapsed Top: Expand Toggle */}
              <button
                onClick={handleToggleSidebar}
                className="p-1.5 hover:bg-zinc-150 dark:hover:bg-zinc-900 rounded text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition"
                title="Expand Sidebar"
              >
                <ChevronRight size={16} />
              </button>

              {/* Collapsed Middle: Features Indicator */}
              <div
                onClick={handleToggleSidebar}
                className="relative group cursor-pointer p-2 rounded hover:bg-zinc-150 dark:hover:bg-zinc-900 transition text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                title="Click to view Features list"
              >
                <Folder size={18} />
                {workflow.state?.features && workflow.state.features.length > 0 && (
                  <span className="absolute -top-1 -right-1 bg-black dark:bg-white text-white dark:text-black text-[9px] w-4 h-4 rounded-full flex items-center justify-center font-bold">
                    {workflow.state.features.length}
                  </span>
                )}
              </div>

              {/* Collapsed Bottom: Agent Prompt Indicator */}
              <div
                onClick={handleToggleSidebar}
                className="group cursor-pointer p-2 rounded hover:bg-zinc-150 dark:hover:bg-zinc-900 transition text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200"
                title={`Trigger Agent: ${activeExec.label}`}
              >
                <Sparkles size={16} />
              </div>
            </>
          ) : (
            <>
              {/* Expanded Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Features Manager</span>
                <button
                  onClick={handleToggleSidebar}
                  className="p-1 hover:bg-zinc-150 dark:hover:bg-zinc-900 rounded text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition"
                  title="Collapse Sidebar"
                >
                  <ChevronLeft size={14} />
                </button>
              </div>

              {/* Create feature form */}
              <form onSubmit={workflow.handleCreateFeature} className="p-4 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="New feature name..."
                    value={workflow.newFeatureName}
                    onChange={(e) => workflow.setNewFeatureName(e.target.value)}
                    className="flex-1 px-3 py-1.5 bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-md text-xs outline-none focus:border-zinc-400 dark:focus:border-zinc-650"
                  />
                  <button
                    type="submit"
                    className="p-2 bg-black dark:bg-white text-white dark:text-black rounded-md hover:opacity-90 transition"
                  >
                    <Plus size={12} />
                  </button>
                </div>
              </form>

              {/* Features list */}
              <div className="flex-1 overflow-y-auto p-3 space-y-1" style={{ scrollbarWidth: 'thin' }}>
                <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                  Features
                </div>
                {workflow.state?.features.map((feat) => {
                  const isActive = workflow.state!.activeFeatureName === feat.name;
                  return (
                    <div
                      key={feat.name}
                      onClick={() => workflow.handleSelectFeature(feat.name)}
                      className={`group flex items-center justify-between px-2.5 py-2 rounded-md text-xs font-medium cursor-pointer transition ${isActive ? 'bg-zinc-100 dark:bg-zinc-900 text-zinc-950 dark:text-zinc-50' : 'text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-950'}`}
                    >
                      <span className="truncate">{feat.name}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          workflow.handleDeleteFeature(feat.name);
                        }}
                        className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded text-zinc-400 hover:text-red-500 transition opacity-0 group-hover:opacity-100"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  );
                })}
                {workflow.state?.features.length === 0 && (
                  <p className="text-xs text-zinc-400 italic p-2">No features created yet.</p>
                )}
              </div>

              {/* Agent execution prompt box */}
              <div className="p-4 pb-6 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-black shrink-0">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                    Trigger Agent: {activeExec.label}
                  </span>
                  <Sparkles size={10} className="text-zinc-400" />
                </div>
                <textarea
                  placeholder="Refinements or prompts..."
                  value={phaseRunner.prompt}
                  onChange={(e) => phaseRunner.setPrompt(e.target.value)}
                  disabled={phaseRunner.running || !workflow.state}
                  className="w-full h-16 p-2 text-xs bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-md outline-none resize-none disabled:opacity-50"
                />
                {phaseRunner.running ? (
                  <button
                    onClick={() => {
                      if (phaseRunner.runningPhase) {
                        phaseRunner.handleStopPhase(phaseRunner.runningPhase.phase, phaseRunner.runningPhase.featureName);
                      }
                    }}
                    className="w-full mt-2 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-md text-xs font-semibold transition flex items-center justify-center gap-1"
                  >
                    <X size={10} /> Stop Execution
                  </button>
                ) : (
                  <button
                    onClick={() => phaseRunner.handleRunPhase(activeExec.phase, null)}
                    disabled={!workflow.state}
                    className="w-full mt-2 py-1.5 bg-black dark:bg-white text-white dark:text-black rounded-md text-xs font-semibold hover:opacity-90 transition flex items-center justify-center gap-1 disabled:opacity-50"
                  >
                    <Play size={10} fill="currentColor" /> Run {activeExec.label}
                  </button>
                )}
              </div>
            </>
          )}
        </aside>

        {/* Central visual panel (Kanban/DAG) and editor split */}
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-white dark:bg-black relative">

          {/* Split Area: Top (Visual Board), Bottom (Editor or Console) */}
          <div className="flex-1 flex flex-col min-h-0">
            {/* Visualizer Area (Kanban / DAG Map) */}
            {!isEditorMaximized && (
              <div className="flex-1 min-h-[50%] relative">
                {workflow.state ? (
                  viewMode === 'kanban' ? (
                    <KanbanBoard
                      state={workflow.state}
                      onRunPhase={phaseRunner.handleRunPhase}
                      onApprovePhase={workflow.handleApprovePhase}
                      onDiscardPhase={workflow.handleDiscardPhase}
                      onSelectFeature={workflow.handleSelectFeature}
                      onDeleteFeature={workflow.handleDeleteFeature}
                      onSelectPhaseFile={(p) => p && workflow.handleLoadFile(p)}
                      onCardDrop={handleCardDrop}
                      onRerunGate={phaseRunner.handleRerunGate}
                      onOpenReview={(name, phaseState) => setAuditingFeature({ name, phaseState })}
                      onStopPhase={phaseRunner.handleStopPhase}
                      onFinishPhase={phaseRunner.handleFinishPhase}
                      onAnswerPhase={(phase, feature, answer) => phaseRunner.handleRunPhase(phase, feature, answer)}
                      onQuickBuild={phaseRunner.handleQuickBuild}
                      onFixAndRetry={phaseRunner.handleFixAndRetry}
                      onBrowserTest={(feature) => {
                        setBrowserTestFeature(feature);
                        setBrowserTestResult(null);
                        setBrowserTestStatus(null);
                      }}
                      onPreview={async (feature) => {
                        if (workflow.state?.activeFeatureName !== feature) await workflow.handleSelectFeature(feature);
                        setActiveTab('preview');
                      }}
                      onCommit={(feature) => setCommitFeature(feature)}
                    />
                  ) : viewMode === 'dag' ? (
                    <DagMap
                      state={workflow.state}
                      onSelectFeature={workflow.handleSelectFeature}
                      onSelectPhaseFile={(p) => p && workflow.handleLoadFile(p)}
                    />
                  ) : (
                    <ExecutionsView
                      state={workflow.state}
                      executions={configStore.executions}
                      devopsAgents={configStore.devopsAgentsFile.agents}
                      runningDevOps={configStore.runningDevOps}
                      onRunDevOps={handleRunDevOpsWithTab}
                      theme={theme}
                    />
                  )
                ) : (
                  <div className="flex items-center justify-center h-full text-zinc-400 text-xs">
                    Loading Spec-Driven Development workspace state...
                  </div>
                )}
              </div>
            )}

            {/* Split panel: Content Editor, Terminal log console, or Full Terminal */}
            <div className={`flex flex-col min-h-0 pb-2 bg-white dark:bg-black transition-all duration-300 ${isEditorMaximized ? 'flex-1 h-full' : 'h-[40%] border-t border-zinc-200 dark:border-zinc-800'}`}>
              {/* Tab Header for lower split */}
              <div className="flex justify-between items-center px-4 py-2 border-b border-zinc-150 dark:border-zinc-900 bg-zinc-50/70 dark:bg-zinc-950/20 shrink-0">
                <div className="flex gap-4">
                  <button
                    onClick={() => setActiveTab('editor')}
                    className={`text-xs font-bold tracking-wide transition pb-1 border-b-2 ${activeTab === 'editor' ? 'text-black dark:text-white border-black dark:border-white' : 'text-zinc-400 border-transparent'}`}
                  >
                    MARKDOWN EDITOR
                  </button>
                  <button
                    onClick={() => setActiveTab('console')}
                    className={`text-xs font-bold tracking-wide transition pb-1 border-b-2 ${activeTab === 'console' ? 'text-black dark:text-white border-black dark:border-white' : 'text-zinc-400 border-transparent'}`}
                  >
                    AGENT RUN CONSOLE {phaseRunner.running && <span className="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse ml-1" />}
                  </button>
                  <button
                    onClick={() => setActiveTab('terminal')}
                    className={`text-xs font-bold tracking-wide transition pb-1 border-b-2 ${activeTab === 'terminal' ? 'text-black dark:text-white border-black dark:border-white' : 'text-zinc-400 border-transparent'}`}
                  >
                    WORKSPACE TERMINAL
                  </button>
                  <button
                    onClick={() => setActiveTab('preview')}
                    className={`text-xs font-bold tracking-wide transition pb-1 border-b-2 ${activeTab === 'preview' ? 'text-black dark:text-white border-black dark:border-white' : 'text-zinc-400 border-transparent'}`}
                  >
                    PREVIEW
                  </button>
                </div>
                <button
                  onClick={() => setIsEditorMaximized(!isEditorMaximized)}
                  className="p-1.5 rounded text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition"
                  title={isEditorMaximized ? "Restore Layout" : "Maximize Panel"}
                >
                  {isEditorMaximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                </button>
              </div>

              {/* Lower split content */}
              <div className="flex-1 min-h-0 overflow-hidden">
                {activeTab === 'editor' && (
                  <div className="h-full p-3 bg-white dark:bg-black flex flex-col gap-2">
                    {workflow.editorNotice && (
                      <p role="alert" className="shrink-0 text-[11px] text-amber-700 dark:text-amber-400 bg-amber-500/10 rounded-md px-2 py-1">{workflow.editorNotice}</p>
                    )}
                    <div className="flex-1 min-h-0">
                    <MarkdownEditor
                      filePath={workflow.selectedFile?.path || null}
                      initialContent={workflow.selectedFile?.content || null}
                      onSave={workflow.handleSaveFile}
                      onToggleTask={workflow.handleToggleTask}
                      state={workflow.state}
                      isMaximized={isEditorMaximized}
                      onToggleMaximize={() => setIsEditorMaximized(!isEditorMaximized)}
                      onSelectFile={workflow.handleLoadFile}
                    />
                    </div>
                  </div>
                )}
                {/* Kept mounted (hidden when inactive) so streamed agent output
                    and the xterm scrollback survive tab switches mid-run. */}
                <div className={activeTab === 'console' ? 'h-full' : 'hidden'}>
                  <AgentConsole
                    ref={agentConsoleRef}
                    active={section === 'workflow' && activeTab === 'console'}
                    running={phaseRunner.running}
                    onInput={phaseRunner.handleAgentInput}
                    onResize={phaseRunner.handleAgentResize}
                  />
                </div>
                {activeTab === 'terminal' && (
                  <TerminalPanel />
                )}
                {/* Kept mounted so the running page isn't reloaded on every tab switch. */}
                <div className={activeTab === 'preview' ? 'h-full' : 'hidden'}>
                  <PreviewPanel
                    active={section === 'workflow' && activeTab === 'preview'}
                    featureName={workflow.state?.activeFeatureName ?? null}
                  />
                </div>
              </div>
            </div>
          </div>
        </main>
        </div>
      </div>
      <AboutModal isOpen={showAbout} onClose={() => setShowAbout(false)} />
      <ExpertiseAssessmentModal
        isOpen={workflow.showExpertiseAssessment}
        onClose={() => workflow.setShowExpertiseAssessment(false)}
        onSave={(profile) => configStore.handleSaveExpertise(profile, {
          setShowExpertiseAssessment: workflow.setShowExpertiseAssessment,
          fetchState: workflow.fetchState,
        })}
        current={workflow.state?.expertiseProfile}
      />
      {configStore.editingPersona && (
        <PersonaEditorModal
          isOpen={true}
          onClose={() => configStore.setEditingPersona(null)}
          persona={configStore.editingPersona}
          onSave={configStore.handleSavePersona}
        />
      )}
      {auditingFeature && (
        <HumanReviewModal
          isOpen={true}
          onClose={() => setAuditingFeature(null)}
          featureName={auditingFeature.name}
          activePhaseState={auditingFeature.phaseState}
          theme={theme}
          onApprove={() => {
            workflow.handleApprovePhase('implementation', auditingFeature.name);
            setAuditingFeature(null);
          }}
        />
      )}
      {browserTestFeature && (
        <ChromeExtensionGuideModal
          isOpen={true}
          onClose={() => setBrowserTestFeature(null)}
          featureName={browserTestFeature}
          onRunTest={handleBrowserTest}
          testStatus={browserTestStatus}
          testResult={browserTestResult}
        />
      )}

      {commitFeature && (
        <GitCommitModal
          isOpen={true}
          onClose={() => setCommitFeature(null)}
          featureName={commitFeature}
        />
      )}

      {/* Floating chat widget */}
      {chatOpen && (
        <div className="fixed bottom-20 right-6 z-50 w-[400px] h-[520px] rounded-xl shadow-2xl border border-zinc-200 dark:border-zinc-700 overflow-hidden flex flex-col bg-white dark:bg-zinc-950">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
            <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 flex items-center gap-2">
              <MessageSquare size={14} /> Project Chat
            </span>
            <button
              onClick={() => setChatOpen(false)}
              className="p-1 rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition"
            >
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <ChatPanel active={chatOpen} />
          </div>
        </div>
      )}
      <button
        onClick={() => setChatOpen(prev => !prev)}
        className={`fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-all ${
          chatOpen
            ? 'bg-zinc-700 dark:bg-zinc-300 text-white dark:text-black'
            : 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black hover:scale-105'
        }`}
        title="Project Chat"
      >
        {chatOpen ? <X size={20} /> : <MessageSquare size={20} />}
      </button>
    </div>
  );
}
export type { WorkflowPhase, AgentConfig, AgentType, PhaseStatus };
