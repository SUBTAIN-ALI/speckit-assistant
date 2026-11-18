import { useState, useEffect, useCallback } from 'react';
import { AgentConfig, PersonaConfig, UserExpertiseProfile } from '@/domain/models/types';
import { DEFAULT_PERSONAS } from '@/domain/models/personas';
import { AgentsFile, DEFAULT_AGENTS, toAgentConfig, activeAgent } from '@/domain/models/agents';
import { McpFile, DEFAULT_MCP } from '@/domain/models/mcp';
import { SpecAgentsFile, DEFAULT_SPEC_AGENTS } from '@/domain/models/specAgents';
import { DevOpsAgentsFile, DEFAULT_DEVOPS_AGENTS } from '@/domain/models/devopsAgents';
import { ExecutionRecord } from '@/domain/models/executions';
import { InstalledExtension, BundledExtension } from '@/domain/models/extensions';
import type { ExtensionAction } from '@/components/ExtensionsPanel';
import type { AgentConsoleHandle } from '@/components/AgentConsole';

interface ConfigStoreDeps {
  agentConsoleRef: React.RefObject<AgentConsoleHandle | null>;
}

export function useConfigStore(deps: ConfigStoreDeps) {
  const { agentConsoleRef } = deps;

  // --- Agents ---
  const [agentsFile, setAgentsFile] = useState<AgentsFile>(DEFAULT_AGENTS);
  const [agentConfig, setAgentConfig] = useState<AgentConfig>({
    agentType: 'claude',
    customCommand: '',
    agentPath: '',
  });

  useEffect(() => {
    const a = activeAgent(agentsFile);
    if (a) setAgentConfig(toAgentConfig(a));
  }, [agentsFile]);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/agents');
      if (res.ok) setAgentsFile(await res.json());
    } catch (err) {
      console.error('Failed to fetch agents:', err);
    }
  }, []);

  const handleSaveAgents = useCallback(async (file: AgentsFile) => {
    setAgentsFile(file);
    try {
      await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(file),
      });
    } catch (err) {
      console.error('Failed to save agents:', err);
    }
  }, []);

  // --- MCP ---
  const [mcpFile, setMcpFile] = useState<McpFile>(DEFAULT_MCP);

  const fetchMcp = useCallback(async () => {
    try {
      const res = await fetch('/api/mcp');
      if (res.ok) setMcpFile(await res.json());
    } catch (err) {
      console.error('Failed to fetch MCP servers:', err);
    }
  }, []);

  const handleSaveMcp = useCallback(async (file: McpFile) => {
    setMcpFile(file);
    try {
      await fetch('/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(file),
      });
    } catch (err) {
      console.error('Failed to save MCP servers:', err);
    }
  }, []);

  const handleApplyMcp = useCallback(async (agentId: string) => {
    const res = await fetch('/api/mcp/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId }),
    });
    return res.json();
  }, []);

  // --- Spec Agents ---
  const [specAgentsFile, setSpecAgentsFile] = useState<SpecAgentsFile>(DEFAULT_SPEC_AGENTS);

  const fetchSpecAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/spec-agents');
      if (res.ok) setSpecAgentsFile(await res.json());
    } catch (err) {
      console.error('Failed to fetch spec agents:', err);
    }
  }, []);

  const handleSaveSpecAgents = useCallback(async (file: SpecAgentsFile) => {
    setSpecAgentsFile(file);
    try {
      await fetch('/api/spec-agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(file),
      });
    } catch (err) {
      console.error('Failed to save spec agents:', err);
    }
  }, []);

  const handleApplySpecAgents = useCallback(async () => {
    const res = await fetch('/api/spec-agents/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(specAgentsFile),
    });
    return res.json();
  }, [specAgentsFile]);

  // --- DevOps Agents ---
  const [devopsAgentsFile, setDevopsAgentsFile] = useState<DevOpsAgentsFile>(DEFAULT_DEVOPS_AGENTS);

  const fetchDevOpsAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/devops-agents');
      if (res.ok) setDevopsAgentsFile(await res.json());
    } catch (err) {
      console.error('Failed to fetch devops agents:', err);
    }
  }, []);

  const handleSaveDevOpsAgents = useCallback(async (file: DevOpsAgentsFile) => {
    setDevopsAgentsFile(file);
    try {
      await fetch('/api/devops-agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(file),
      });
    } catch (err) {
      console.error('Failed to save devops agents:', err);
    }
  }, []);

  // --- Personas ---
  const [personaConfigs, setPersonaConfigs] = useState<PersonaConfig[]>(DEFAULT_PERSONAS);
  const [editingPersona, setEditingPersona] = useState<PersonaConfig | null>(null);

  const fetchPersonas = useCallback(async () => {
    try {
      const res = await fetch('/api/personas');
      if (res.ok) {
        const data = await res.json();
        setPersonaConfigs(data);
      }
    } catch (err) {
      console.error('Failed to fetch personas:', err);
    }
  }, []);

  const handleSavePersonasList = useCallback(async (next: PersonaConfig[]) => {
    setPersonaConfigs(next);
    try {
      await fetch('/api/personas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
    } catch (err) {
      console.error('Failed to save personas:', err);
    }
  }, []);

  const handleSavePersona = useCallback(async (updated: PersonaConfig) => {
    const next = personaConfigs.map(p => p.id === updated.id ? updated : p);
    setPersonaConfigs(next);
    setEditingPersona(null);
    try {
      await fetch('/api/personas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
    } catch (err) {
      console.error('Failed to save persona config:', err);
    }
  }, [personaConfigs]);

  // --- Executions ---
  const [executions, setExecutions] = useState<ExecutionRecord[]>([]);
  const [runningDevOps, setRunningDevOps] = useState<string | null>(null);

  const fetchExecutions = useCallback(async () => {
    try {
      const res = await fetch('/api/executions');
      if (res.ok) setExecutions((await res.json()).executions || []);
    } catch (err) {
      console.error('Failed to fetch executions:', err);
    }
  }, []);

  const consumeDevOpsStream = useCallback(async (response: Response) => {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value);
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const dataLine = line.split('\n').find(l => l.startsWith('data: '));
        if (!dataLine) continue;
        const data = JSON.parse(dataLine.substring(6));
        if (line.startsWith('event: log')) {
          agentConsoleRef.current?.write(data.text);
        } else if (line.startsWith('event: done')) {
          agentConsoleRef.current?.write(`\r\n\x1b[32mDevOps run finished (exit ${data.exitCode}).\x1b[0m\r\n`);
        } else if (line.startsWith('event: error')) {
          agentConsoleRef.current?.write(`\r\n\x1b[31mError: ${data.message}\x1b[0m\r\n`);
        }
      }
    }
    fetchExecutions();
  }, [agentConsoleRef, fetchExecutions]);

  const handleRunDevOps = useCallback(async (agentId: string, featureName: string | null) => {
    const agent = devopsAgentsFile.agents.find(a => a.id === agentId);
    agentConsoleRef.current?.clear();
    agentConsoleRef.current?.write(`\x1b[36m=== DevOps: ${agent?.label || agentId} ===\x1b[0m\r\n`);
    setRunningDevOps(agentId);
    try {
      const response = await fetch('/api/devops/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, featureName: featureName || null, agentConfig }),
      });
      if (!response.ok || !response.body) {
        const err = await response.json().catch(() => ({ error: 'Run failed' }));
        agentConsoleRef.current?.write(`\r\n\x1b[31mError: ${err.error}\x1b[0m\r\n`);
        return;
      }
      await consumeDevOpsStream(response);
    } catch (err: any) {
      agentConsoleRef.current?.write(`\r\n\x1b[31mExecution failed: ${err.message}\x1b[0m\r\n`);
    } finally {
      setRunningDevOps(null);
      fetchExecutions();
    }
  }, [devopsAgentsFile, agentConsoleRef, agentConfig, consumeDevOpsStream, fetchExecutions]);

  // --- Extensions ---
  const [extState, setExtState] = useState<{ available: boolean; installed: InstalledExtension[]; bundled: BundledExtension[] }>({ available: false, installed: [], bundled: [] });

  const fetchExtensions = useCallback(async () => {
    try {
      const res = await fetch('/api/extensions');
      if (res.ok) setExtState(await res.json());
    } catch (err) {
      console.error('Failed to fetch extensions:', err);
    }
  }, []);

  const handleExtensionAction = useCallback(async (a: ExtensionAction) => {
    const res = await fetch('/api/extensions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(a),
    });
    const data = await res.json();
    setExtState(prev => ({
      ...prev,
      ...(Array.isArray(data.installed) ? { installed: data.installed } : {}),
      ...(typeof data.available === 'boolean' ? { available: data.available } : {}),
    }));
    if (a.action === 'install-cli' && data.available) fetchExtensions();
    return data;
  }, [fetchExtensions]);

  // --- Expertise ---
  const handleSaveExpertise = useCallback(async (
    profile: UserExpertiseProfile,
    callbacks: { setShowExpertiseAssessment: (v: boolean) => void; fetchState: () => Promise<void> }
  ) => {
    try {
      await fetch('/api/expertise', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      });
      callbacks.setShowExpertiseAssessment(false);
      callbacks.fetchState();
    } catch (err) {
      console.error('Failed to save expertise profile:', err);
    }
  }, []);

  // --- Init: fetch all config on mount ---
  useEffect(() => {
    fetchAgents();
    fetchMcp();
    fetchSpecAgents();
    fetchDevOpsAgents();
    fetchPersonas();
    fetchExecutions();
    fetchExtensions();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    agentConfig,
    agentsFile,
    handleSaveAgents,
    mcpFile,
    handleSaveMcp,
    handleApplyMcp,
    specAgentsFile,
    handleSaveSpecAgents,
    handleApplySpecAgents,
    devopsAgentsFile,
    handleSaveDevOpsAgents,
    personaConfigs,
    editingPersona,
    setEditingPersona,
    handleSavePersonasList,
    handleSavePersona,
    executions,
    fetchExecutions,
    runningDevOps,
    handleRunDevOps,
    extState,
    handleExtensionAction,
    handleSaveExpertise,
  };
}
