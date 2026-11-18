import { useState, useEffect, useRef, useCallback } from 'react';
import { WorkflowState, WorkflowPhase, PhaseStatus } from '@/domain/models/types';
import { isWorkflowState } from '@/lib/workflowState';

export function useWorkflowState(onExternalChange?: () => void) {
  const [state, setStateRaw] = useState<WorkflowState | null>(null);
  const setState = useCallback((next: unknown) => {
    if (isWorkflowState(next)) setStateRaw(next);
    else console.error('Ignoring invalid workflow state from the API:', next);
  }, []);

  const [selectedFile, setSelectedFile] = useState<{ path: string; content: string } | null>(null);
  const [editorNotice, setEditorNotice] = useState<string | null>(null);
  const [newFeatureName, setNewFeatureName] = useState('');
  const [showExpertiseAssessment, setShowExpertiseAssessment] = useState(false);

  useEffect(() => {
    if (!editorNotice) return;
    const t = setTimeout(() => setEditorNotice(null), 6000);
    return () => clearTimeout(t);
  }, [editorNotice]);

  const selectedFileRef = useRef(selectedFile);
  useEffect(() => {
    selectedFileRef.current = selectedFile;
  }, [selectedFile]);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch('/api/state');
      const data = await res.json();
      setState(data);
      if (data && !data.expertiseProfile) {
        setShowExpertiseAssessment(true);
      }
    } catch (err) {
      console.error('Failed to fetch state:', err);
    }
  }, [setState]);

  const handleLoadFile = useCallback(async (path: string) => {
    try {
      const res = await fetch(`/api/file?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      setSelectedFile(data);
    } catch (err) {
      console.error(err);
    }
  }, []);

  const handleSaveFile = useCallback(async (content: string) => {
    if (!selectedFile) return;
    try {
      const res = await fetch('/api/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: selectedFile.path, content }),
      });
      const data = await res.json();
      setSelectedFile({ path: selectedFile.path, content });
      if (data.state) {
        setState(data.state);
      }
    } catch (err) {
      console.error(err);
    }
  }, [selectedFile, setState]);

  const handleToggleTask = useCallback(async (lineIndex: number, checked: boolean) => {
    const filePath = selectedFile?.path;
    if (!filePath) return;
    try {
      const res = await fetch('/api/task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath, lineIndex, checked }),
      });
      const data = await res.json();
      if (!res.ok) {
        setEditorNotice(data.error || 'Couldn’t update the checkbox.');
      } else {
        setState(data);
      }
      handleLoadFile(filePath);
    } catch (err) {
      console.error(err);
    }
  }, [selectedFile?.path, setState, handleLoadFile]);

  const handleSelectFeature = useCallback(async (name: string) => {
    try {
      const res = await fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activeFeatureName: name }),
      });
      const data = await res.json();
      setState(data);

      const feature = data.features.find((f: any) => f.name === name);
      const specPhase = feature?.phases.find((p: any) => p.phase === 'specification');
      if (specPhase?.filePath) {
        handleLoadFile(specPhase.filePath);
      } else {
        setSelectedFile(null);
      }
    } catch (err) {
      console.error(err);
    }
  }, [setState, handleLoadFile]);

  const handleCreateFeature = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFeatureName.trim()) return;
    try {
      const res = await fetch('/api/feature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newFeatureName.trim() }),
      });
      const data = await res.json();
      setState(data);
      setNewFeatureName('');

      const specPath = `specs/${newFeatureName.trim()}/spec.md`;
      setSelectedFile({ path: specPath, content: '' });
    } catch (err) {
      console.error(err);
    }
  }, [newFeatureName, setState]);

  const handleDeleteFeature = useCallback(async (name: string) => {
    if (!confirm(`Are you sure you want to delete feature "${name}"?`)) return;
    try {
      const res = await fetch('/api/feature', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      setState(data);
      if (state?.activeFeatureName === name) {
        setSelectedFile(null);
      }
    } catch (err) {
      console.error(err);
    }
  }, [state?.activeFeatureName, setState]);

  const handleApprovePhase = useCallback(async (phase: WorkflowPhase, featureName: string | null) => {
    try {
      const res = await fetch('/api/phase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'approve',
          phase,
          featureName: featureName || state?.activeFeatureName
        })
      });
      const data = await res.json();
      setState(data);
    } catch (err) {
      console.error(err);
    }
  }, [state?.activeFeatureName, setState]);

  const handleDiscardPhase = useCallback(async (phase: WorkflowPhase, featureName: string | null) => {
    try {
      const res = await fetch('/api/phase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'discard',
          phase,
          featureName: featureName || state?.activeFeatureName
        })
      });
      const data = await res.json();
      setState(data);
      if (selectedFile?.path && selectedFile.path.includes(phase)) {
        setSelectedFile(null);
      }
    } catch (err) {
      console.error(err);
    }
  }, [state?.activeFeatureName, selectedFile?.path, setState]);

  // Deep link into a section, e.g. the Zoom OAuth callback's ?section=requirements.
  const [deepLinkSection, setDeepLinkSection] = useState<string | null>(null);
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get('section');
    if (s) setDeepLinkSection(s);
  }, []);

  // SSE state watcher — keeps workflow state and open file in sync with disk.
  // Reconnects automatically on network errors with capped backoff.
  useEffect(() => {
    fetchState();

    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout>;
    let retryDelay = 1_000;
    let unmounted = false;
    const MAX_RETRY_DELAY = 30_000;

    function connect() {
      if (unmounted) return;
      es = new EventSource('/api/state/watch');

      es.addEventListener('update', (event) => {
        retryDelay = 1_000;
        const payload = JSON.parse(event.data);
        const newState = payload.state || payload;
        const changedFile = payload.changedFile || null;

        setState(newState);

        if (!changedFile || changedFile.includes('executions.jsonl') || changedFile.includes('workflow-state.json')) {
          onExternalChange?.();
        }

        if (selectedFileRef.current && changedFile) {
          const currentPath = selectedFileRef.current.path.replace(/\\/g, '/');
          const normChangedFile = changedFile.replace(/\\/g, '/');
          if (currentPath === normChangedFile) {
            handleLoadFile(selectedFileRef.current.path);
          }
        }
      });

      es.addEventListener('error', () => {
        es?.close();
        es = null;
        if (unmounted) return;
        retryTimer = setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY);
      });
    }

    connect();

    return () => {
      unmounted = true;
      es?.close();
      clearTimeout(retryTimer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    state,
    setState,
    selectedFile,
    setSelectedFile,
    editorNotice,
    newFeatureName,
    setNewFeatureName,
    showExpertiseAssessment,
    setShowExpertiseAssessment,
    deepLinkSection,
    fetchState,
    handleLoadFile,
    handleSaveFile,
    handleToggleTask,
    handleSelectFeature,
    handleCreateFeature,
    handleDeleteFeature,
    handleApprovePhase,
    handleDiscardPhase,
  };
}
