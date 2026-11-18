import { useState, useRef, useCallback } from 'react';
import {
  WorkflowState,
  WorkflowPhase,
  AgentConfig,
  PersonaConfig,
  PersonaId,
  isPhaseDone,
} from '@/domain/models/types';
import type { AgentConsoleHandle } from '@/components/AgentConsole';
import { isWorkflowState } from '@/lib/workflowState';

const PHASE_LABELS: Record<WorkflowPhase, string> = {
  constitution: 'Constitution',
  specification: 'Specification',
  clarification: 'Clarification',
  planning: 'Planning',
  checklist: 'Checklist',
  analyze: 'Analysis',
  tasks: 'Tasks',
  taskstoissues: 'Tasks to Issues',
  implementation: 'Implementation',
};

const STREAM_TIMEOUT_MS = 300_000;

interface PhaseRunnerDeps {
  agentConsoleRef: React.RefObject<AgentConsoleHandle | null>;
  state: WorkflowState | null;
  agentConfig: AgentConfig;
  personaConfigs: PersonaConfig[];
  handleLoadFile: (path: string) => Promise<void>;
  handleSelectFeature: (name: string) => Promise<void>;
  setState: (next: unknown) => void;
  fetchState: () => Promise<void>;
}

export function usePhaseRunner(deps: PhaseRunnerDeps) {
  const { agentConsoleRef, state, agentConfig, personaConfigs, handleLoadFile, handleSelectFeature, setState, fetchState } = deps;

  // `runningPhase` is the single source of truth for "is a phase actively
  // streaming?"  The derived `running` boolean below replaces what was
  // previously a separate, duplicate useState.
  const [runningPhase, setRunningPhase] = useState<{ phase: WorkflowPhase; featureName: string | null } | null>(null);
  const running = runningPhase !== null;

  const [lastPhase, setLastPhase] = useState<{ phase: WorkflowPhase; featureName: string | null } | null>(null);
  const [prompt, setPrompt] = useState('');
  const replyBuf = useRef('');

  const activePersonaId = useCallback((): PersonaId | undefined => {
    if (runningPhase?.phase !== 'implementation') return undefined;
    const feat = state?.features.find(f => f.name === runningPhase.featureName);
    const impl = feat?.phases.find(p => p.phase === 'implementation');
    return impl?.personas?.find(p => p.status === 'running')?.id;
  }, [runningPhase, state]);

  const resetRun = useCallback(() => {
    setRunningPhase(null);
  }, []);

  const consumePhaseStream = useCallback(async (
    response: Response,
    phase: WorkflowPhase,
    featureName: string | null,
  ) => {
    const reader = response.body?.getReader();
    if (!reader) {
      resetRun();
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    // Stream timeout: if no data arrives for STREAM_TIMEOUT_MS, assume the
    // connection is dead and recover the UI so the user isn't stuck.
    let lastActivity = Date.now();
    const timeoutCheck = setInterval(() => {
      if (Date.now() - lastActivity > STREAM_TIMEOUT_MS) {
        clearInterval(timeoutCheck);
        reader.cancel().catch(() => {});
        agentConsoleRef.current?.write(
          '\r\n\x1b[31m✗ Connection lost — no data received for 90 seconds.\x1b[0m\r\n' +
          '\x1b[36m  The agent may still be running on the server. Click Run to reconnect, or check the console.\x1b[0m\r\n'
        );
        resetRun();
        fetchState();
      }
    }, 10_000);

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        lastActivity = Date.now();

        buffer += decoder.decode(value);
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event: log')) {
            const dataLine = line.split('\n').find(l => l.startsWith('data: '));
            if (dataLine) {
              const data = JSON.parse(dataLine.substring(6));
              agentConsoleRef.current?.write(data.text);
            }
          } else if (line.startsWith('event: done')) {
            const dataLine = line.split('\n').find(l => l.startsWith('data: '));
            if (dataLine) {
              const data = JSON.parse(dataLine.substring(6));
              setState(data.state);
              const targetFeature = featureName || data.state.activeFeatureName;
              const feat = data.state.features.find((f: any) => f.name === targetFeature);
              const activePhase = feat?.phases.find((p: any) => p.phase === phase);
              if (activePhase?.filePath) {
                handleLoadFile(activePhase.filePath);
              }

              setRunningPhase(null);
              setPrompt('');

              if (activePhase?.status === 'failed') {
                const msg = activePhase.attention?.message ?? 'Phase failed.';
                agentConsoleRef.current?.write(`\r\n\x1b[31m✗ ${msg}\x1b[0m\r\n`);
                if (activePhase.attention?.question) {
                  agentConsoleRef.current?.write(`\r\n\x1b[33m  The agent asked: ${activePhase.attention.question}\x1b[0m\r\n`);
                }
                agentConsoleRef.current?.write('\r\n\x1b[36m  Type a message and press Enter to retry with context, or click Run on the card.\x1b[0m ');
                setLastPhase({ phase, featureName: targetFeature });
                replyBuf.current = '';
              } else {
                setLastPhase({ phase, featureName: targetFeature });
                replyBuf.current = '';
                agentConsoleRef.current?.write('\r\n\x1b[36m  Reply to continue (Enter to send):\x1b[0m ');
              }
            } else {
              resetRun();
            }
          } else if (line.startsWith('event: error')) {
            const dataLine = line.split('\n').find(l => l.startsWith('data: '));
            if (dataLine) {
              const data = JSON.parse(dataLine.substring(6));
              agentConsoleRef.current?.write(`\r\n\x1b[31m✗ Error: ${data.message}\x1b[0m\r\n`);
              agentConsoleRef.current?.write('\r\n\x1b[36m  Fix the issue and click Run on the card to retry.\x1b[0m\r\n');
            }
            resetRun();
          }
        }
      }
    } finally {
      clearInterval(timeoutCheck);
    }

    fetchState();
  }, [agentConsoleRef, setState, handleLoadFile, fetchState, resetRun]);

  const handleRunPhase = useCallback(async (phase: WorkflowPhase, featureName: string | null, promptOverride?: string) => {
    agentConsoleRef.current?.clear();
    setLastPhase(null);
    replyBuf.current = '';
    setRunningPhase({ phase, featureName: featureName || state?.activeFeatureName || null });

    try {
      const response = await fetch('/api/phase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'run',
          phase,
          featureName: featureName || state?.activeFeatureName,
          agentConfig,
          prompt: promptOverride ?? prompt,
          ...(phase === 'implementation' ? { personas: personaConfigs } : {})
        })
      });
      await consumePhaseStream(response, phase, featureName);
    } catch (err: any) {
      agentConsoleRef.current?.write(`\r\n\x1b[31mExecution failed: ${err.message}\x1b[0m\r\n`);
      resetRun();
    }
  }, [agentConsoleRef, state?.activeFeatureName, agentConfig, prompt, personaConfigs, consumePhaseStream, resetRun]);

  const handleQuickBuild = useCallback(async (featureName: string) => {
    agentConsoleRef.current?.clear();
    setRunningPhase({ phase: 'implementation', featureName });
    try {
      if (state?.activeFeatureName !== featureName) await handleSelectFeature(featureName);
      const response = await fetch('/api/phase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'quick-build', phase: 'implementation', featureName, agentConfig, personas: personaConfigs }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        agentConsoleRef.current?.write(`\r\n\x1b[31mQuick build failed: ${data.error ?? response.status}\x1b[0m\r\n`);
        resetRun();
        return;
      }
      await consumePhaseStream(response, 'implementation', featureName);
    } catch (err: any) {
      agentConsoleRef.current?.write(`\r\n\x1b[31mExecution failed: ${err.message}\x1b[0m\r\n`);
      resetRun();
    }
  }, [agentConsoleRef, state?.activeFeatureName, agentConfig, personaConfigs, handleSelectFeature, consumePhaseStream, resetRun]);

  const handleRerunGate = useCallback(async (featureName: string | null) => {
    const feature = featureName || state?.activeFeatureName || null;
    agentConsoleRef.current?.clear();
    setRunningPhase({ phase: 'implementation', featureName: feature });

    try {
      const response = await fetch('/api/phase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'run-gate',
          phase: 'implementation',
          featureName: feature,
          agentConfig,
          personas: personaConfigs
        })
      });
      await consumePhaseStream(response, 'implementation', feature);
    } catch (err: any) {
      agentConsoleRef.current?.write(`\r\n\x1b[31mExecution failed: ${err.message}\x1b[0m\r\n`);
      resetRun();
    }
  }, [agentConsoleRef, state?.activeFeatureName, agentConfig, personaConfigs, consumePhaseStream, resetRun]);

  const handleFixAndRetry = useCallback(async (featureName: string, failedPersonaId: PersonaId, fixInstruction: string) => {
    agentConsoleRef.current?.clear();
    setRunningPhase({ phase: 'implementation', featureName });

    try {
      const response = await fetch('/api/phase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'fix',
          phase: 'implementation',
          featureName,
          failedPersonaId,
          fixInstruction,
          agentConfig,
          personas: personaConfigs,
        })
      });
      await consumePhaseStream(response, 'implementation', featureName);
    } catch (err: any) {
      agentConsoleRef.current?.write(`\r\n\x1b[31mFix failed: ${err.message}\x1b[0m\r\n`);
      resetRun();
    }
  }, [agentConsoleRef, agentConfig, personaConfigs, consumePhaseStream, resetRun]);

  const handleStopPhase = useCallback(async (phase: WorkflowPhase, featureName: string | null) => {
    try {
      const targetFeature = featureName || state?.activeFeatureName || null;
      const personaId = activePersonaId();
      await fetch('/api/phase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'stop',
          phase,
          featureName: targetFeature,
          personaId
        })
      });
      resetRun();
      fetchState();
    } catch (err) {
      console.error('Failed to stop phase:', err);
    }
  }, [state?.activeFeatureName, activePersonaId, fetchState, resetRun]);

  const handleFinishPhase = useCallback(async (phase: WorkflowPhase, featureName: string | null) => {
    try {
      const res = await fetch('/api/phase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'finish', phase, featureName: featureName || state?.activeFeatureName || null }),
      });
      const next = await res.json();
      if (isWorkflowState(next)) setState(next);
    } catch (err) {
      console.error('Failed to finish phase', err);
    } finally {
      resetRun();
    }
  }, [state?.activeFeatureName, setState, resetRun]);

  const handleAgentInput = useCallback((data: string) => {
    if (runningPhase) {
      fetch('/api/phase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'input',
          phase: runningPhase.phase,
          featureName: runningPhase.featureName,
          text: data,
          personaId: activePersonaId()
        })
      }).catch((err) => console.error('Failed to send input:', err));
      return;
    }

    if (!lastPhase) return;

    if (data === '\r' || data === '\n') {
      const reply = replyBuf.current.trim();
      if (!reply) return;
      agentConsoleRef.current?.write('\r\n');
      replyBuf.current = '';
      const { phase, featureName } = lastPhase;
      setLastPhase(null);
      handleRunPhase(phase, featureName, reply);
    } else if (data === '\x7f' || data === '\b') {
      if (replyBuf.current.length > 0) {
        replyBuf.current = replyBuf.current.slice(0, -1);
        agentConsoleRef.current?.write('\b \b');
      }
    } else if (data >= ' ') {
      replyBuf.current += data;
      agentConsoleRef.current?.write(data);
    }
  }, [runningPhase, lastPhase, activePersonaId, agentConsoleRef, handleRunPhase]);

  const handleAgentResize = useCallback((cols: number, rows: number) => {
    if (!runningPhase) return;
    fetch('/api/phase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'resize',
        phase: runningPhase.phase,
        featureName: runningPhase.featureName,
        cols,
        rows,
        personaId: activePersonaId()
      })
    }).catch(() => {});
  }, [runningPhase, activePersonaId]);

  const getActivePhaseForExecution = useCallback((): { phase: WorkflowPhase; label: string } => {
    if (!state) return { phase: 'constitution', label: 'Constitution' };
    if (state.constitutionPhase.status !== 'approved') {
      return { phase: 'constitution', label: 'Constitution' };
    }
    const feat = state.features.find(f => f.name === state.activeFeatureName);
    if (!feat) return { phase: 'specification', label: 'Specification' };

    for (const p of feat.phases) {
      if (!isPhaseDone(p.status)) {
        return { phase: p.phase, label: PHASE_LABELS[p.phase] };
      }
    }
    return { phase: 'specification', label: 'Specification' };
  }, [state]);

  return {
    running,
    runningPhase,
    lastPhase,
    prompt,
    setPrompt,
    handleRunPhase,
    handleQuickBuild,
    handleRerunGate,
    handleFixAndRetry,
    handleStopPhase,
    handleFinishPhase,
    handleAgentInput,
    handleAgentResize,
    getActivePhaseForExecution,
  };
}
