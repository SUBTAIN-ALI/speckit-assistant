#!/usr/bin/env node
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import open from 'open';
import * as os from 'os';
import { workflowService, meetingImportService, requirementsService, featureCreationService, agentRepository } from '../adapters/di';
import { activeAgent, toAgentConfig } from '../domain/models/agents';
import { FeatureGroup, slugify } from '../domain/services/featureGrouping';
import { WorkflowPhase, AgentConfig, AgentType } from '../domain/models/types';
import { ImportInput } from '../domain/services/MeetingImportService';
import { isAudioFilename } from '../domain/services/transcript';

const args = process.argv.slice(2);

// Resolve workspace path
function resolveWorkspace(cmdArgs: string[], projectDir: string): string {
  const flagIndex = cmdArgs.findIndex(arg => arg === '-w' || arg === '--workspace');
  if (flagIndex !== -1 && cmdArgs[flagIndex + 1]) {
    const resolved = path.resolve(cmdArgs[flagIndex + 1]);
    saveWorkspacePath(projectDir, resolved);
    return resolved;
  }
  for (let i = 0; i < cmdArgs.length; i++) {
    const arg = cmdArgs[i];
    if (!arg.startsWith('-')) {
      const prev = cmdArgs[i - 1];
      if (prev !== '-p' && prev !== '--port' && prev !== '-w' && prev !== '--workspace' && prev !== '--agent' && prev !== '--prompt') {
        if (fs.existsSync(arg) && fs.statSync(arg).isDirectory()) {
          const resolved = path.resolve(arg);
          saveWorkspacePath(projectDir, resolved);
          return resolved;
        }
      }
    }
  }
  
  const saved = loadWorkspacePath(projectDir);
  if (saved) {
    return saved;
  }

  const fallback = process.cwd();
  saveWorkspacePath(projectDir, fallback);
  return fallback;
}

function loadWorkspacePath(projectDir: string): string | null {
  try {
    const configPath = path.join(os.homedir(), '.speckit-assistant-config.json');
    if (fs.existsSync(configPath)) {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return data.lastWorkspacePath || null;
    }
  } catch {
    // ignore
  }
  return null;
}

function saveWorkspacePath(projectDir: string, resolvedPath: string) {
  try {
    const configPath = path.join(os.homedir(), '.speckit-assistant-config.json');
    fs.writeFileSync(configPath, JSON.stringify({ lastWorkspacePath: resolvedPath }, null, 2), 'utf-8');
  } catch {
    // ignore
  }
}

const appDir = path.resolve(__dirname, '../..');
const workspacePath = resolveWorkspace(args, appDir);
process.env.WORKSPACE_PATH = workspacePath;

const subcommands = ['status', 'approve', 'discard', 'run', 'create', 'delete', 'import', 'requirements', 'create-features'];
const firstArg = args[0];

// Help menu
function showHelp() {
  console.log(`
🌱 Spec Kit Assistant CLI

Usage:
  speckit-assistant                   Start the Web UI server
  speckit-assistant status            Show current SDD workflow status
  speckit-assistant approve <phase> [feature]   Approve a phase
  speckit-assistant discard <phase> [feature]   Reset/discard a phase
  speckit-assistant create <feature>  Create a new feature folder
  speckit-assistant delete <feature>  Delete a feature folder
  speckit-assistant import <file|zoom-link> [--title <name>]   Import a meeting (transcript, recording or Zoom link) into a new requirement list
  speckit-assistant requirements [list]                        List requirement lists, or one list's requirements
  speckit-assistant create-features <list> [--single] [--all]  Create Spec Kit features from accepted requirements
  speckit-assistant run <phase> [feature] [--agent <type>] [--prompt <text>]  Run an agent phase

Options:
  -w, --workspace <path>              Specify target workspace path (default: current directory)
  -p, --port <number>                 Specify Web UI server port (default: 18080)
  --agent <claude|gemini|copilot>     AI agent to use for run command (default: claude)
  --prompt <text>                     User refinements or prompt additions for the run
  --help                              Show this help menu
`);
}

if (args.includes('--help') || args.includes('-h')) {
  showHelp();
  process.exit(0);
}

// 1. Run Subcommands
if (firstArg && subcommands.includes(firstArg)) {
  handleSubcommand(firstArg, args.slice(1));
} else {
  // 2. Start Web Server
  startWebServer();
}

// --- Web Server Launcher ---
function startWebServer() {
  const portFlagIndex = args.findIndex(arg => arg === '-p' || arg === '--port');
  const port = portFlagIndex !== -1 && args[portFlagIndex + 1] ? args[portFlagIndex + 1] : '18080';

  console.log(`\n🌱 Spec Kit Assistant Web Server`);
  console.log(`📂 Workspace: ${workspacePath}`);
  console.log(`🔌 Starting server on port ${port}...\n`);

  // Server files are compiled in the same parent directory
  const appDir = path.resolve(__dirname, '../..');
  let nextBin = '';
  try {
    const nextPkg = require.resolve('next/package.json', { paths: [appDir] });
    nextBin = path.join(path.dirname(nextPkg), 'dist', 'bin', 'next');
  } catch (err) {
    nextBin = path.join(appDir, 'node_modules', 'next', 'dist', 'bin', 'next');
  }

  if (!fs.existsSync(nextBin)) {
    console.error(`Error: next binary not found at ${nextBin}`);
    console.error(`Please make sure next is installed.`);
    process.exit(1);
  }

  // Bind to loopback only: the API can spawn agent CLIs and holds the user's
  // API keys / Zoom tokens, so it must not be reachable from the network.
  const child = spawn(process.execPath, [nextBin, 'start', '-p', port, '-H', '127.0.0.1'], {
    cwd: appDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      WORKSPACE_PATH: workspacePath,
      // Lets the API locate the app's bundled extensions/ dir at runtime.
      SPECKIT_ASSISTANT_ROOT: appDir
    }
  });

  setTimeout(() => {
    const url = `http://localhost:${port}`;
    console.log(`\n🚀 Speckit Assistant available at: ${url}`);
    open(url).catch(() => {});
  }, 2500);

  child.on('exit', (code) => {
    process.exit(code || 0);
  });

  process.on('SIGINT', () => {
    child.kill('SIGINT');
    process.exit(0);
  });
}

// --- CLI Subcommand Handlers ---
async function handleSubcommand(command: string, cmdArgs: string[]) {
  try {
    switch (command) {
      case 'status':
        await printStatus();
        break;
      case 'approve':
        await approvePhase(cmdArgs);
        break;
      case 'discard':
        await discardPhase(cmdArgs);
        break;
      case 'create':
        await createFeature(cmdArgs);
        break;
      case 'delete':
        await deleteFeature(cmdArgs);
        break;
      case 'run':
        await runPhase(cmdArgs);
        break;
      case 'import':
        await importMeeting(cmdArgs);
        break;
      case 'requirements':
        await listRequirements(cmdArgs);
        break;
      case 'create-features':
        await createFeaturesFromRequirements(cmdArgs);
        break;
    }
    process.exit(typeof process.exitCode === 'number' ? process.exitCode : 0);
  } catch (err: any) {
    console.error(`\n❌ Error: ${err.message}`);
    process.exit(1);
  }
}

async function printStatus() {
  const state = await workflowService.getWorkflowState(workspacePath);
  console.log(`\n🌱 SDD WORKFLOW STATUS`);
  console.log(`📂 Workspace: ${workspacePath}`);
  console.log(`----------------------------------------------------------------------`);
  
  // Constitution status
  console.log(`📜 Constitution: [${state.constitutionPhase.status.toUpperCase()}] ${state.constitutionPhase.stale ? '(STALE)' : ''}`);
  console.log(`   File: ${state.constitutionPhase.filePath || 'Not created'}`);
  console.log(`----------------------------------------------------------------------`);

  // Features status
  if (state.features.length === 0) {
    console.log(`(No features found in specs/ directory)`);
    return;
  }

  state.features.forEach(feat => {
    console.log(`\n🔹 Feature: "${feat.name}"`);
    feat.phases.forEach(p => {
      let progressStr = '';
      if (p.phase === 'tasks' && p.content) {
        const checkboxes = [...p.content.matchAll(/^\s*(?:[-*]|\d+\.)\s+\[( |x|X)\]/gm)];
        if (checkboxes.length > 0) {
          const done = checkboxes.filter(c => c[1].toLowerCase() === 'x').length;
          progressStr = ` (${done}/${checkboxes.length} tasks)`;
        }
      }
      const statusLabel = p.status.toUpperCase();
      const staleLabel = p.stale ? ' (STALE)' : '';
      console.log(`   - [${p.phase.padEnd(14)}]: ${statusLabel}${staleLabel}${progressStr}`);
    });
  });
  console.log();
}

async function approvePhase(cmdArgs: string[]) {
  const phase = cmdArgs[0] as WorkflowPhase;
  if (!phase) throw new Error('Missing phase argument. Usage: approve <phase> [feature]');
  
  let feature: string | null = null;
  if (phase !== 'constitution') {
    feature = cmdArgs[1] || null;
    if (!feature) {
      const state = await workflowService.getWorkflowState(workspacePath);
      feature = state.activeFeatureName;
      if (!feature) throw new Error('No active feature. Please specify feature name.');
    }
  }

  console.log(`Approving phase "${phase}"${feature ? ` for feature "${feature}"` : ''}...`);
  await workflowService.approvePhase(workspacePath, phase, feature);
  console.log('✅ Approved successfully!');
}

async function discardPhase(cmdArgs: string[]) {
  const phase = cmdArgs[0] as WorkflowPhase;
  if (!phase) throw new Error('Missing phase argument. Usage: discard <phase> [feature]');

  let feature: string | null = null;
  if (phase !== 'constitution') {
    feature = cmdArgs[1] || null;
    if (!feature) {
      const state = await workflowService.getWorkflowState(workspacePath);
      feature = state.activeFeatureName;
      if (!feature) throw new Error('No active feature. Please specify feature name.');
    }
  }

  console.log(`Discarding/resetting phase "${phase}"${feature ? ` for feature "${feature}"` : ''}...`);
  await workflowService.discardPhase(workspacePath, phase, feature);
  console.log('✅ Discarded/reset successfully!');
}

// --- Meeting → requirements → features (same services as the Requirements section) ---

// A function declaration (not a const) so it's available to handleSubcommand,
// which runs while this module is still being evaluated.
function flagValue(cmdArgs: string[], flag: string): string | undefined {
  const i = cmdArgs.indexOf(flag);
  return i !== -1 ? cmdArgs[i + 1] : undefined;
}

async function importMeeting(cmdArgs: string[]) {
  const source = cmdArgs[0];
  if (!source) throw new Error('Usage: import <transcript-file | recording | zoom-link | meeting-id> [--title <name>]');
  const title = flagValue(cmdArgs, '--title');
  const filename = path.basename(source);
  const input: ImportInput = !(fs.existsSync(source) && fs.statSync(source).isFile())
    ? { type: 'link', value: source }
    : isAudioFilename(filename)
      ? { type: 'audio', data: fs.readFileSync(source), filename }
      : { type: 'transcript', text: fs.readFileSync(source, 'utf-8'), filename };
  console.log(`Importing ${input.type === 'link' ? source : filename}...`);
  const out = await meetingImportService.import({ workspacePath, input, title }, p => console.log(`  · ${p.message}`));
  if (out.status !== 'ok') throw new Error(out.message);
  console.log(`✅ ${out.message}`);
  console.log(`   List: ${out.setId}  (speckit-assistant requirements ${out.setId})`);
}

async function listRequirements(cmdArgs: string[]) {
  const setId = cmdArgs[0] && !cmdArgs[0].startsWith('-') ? cmdArgs[0] : null;
  if (!setId) {
    const sets = await requirementsService.list(workspacePath);
    if (sets.length === 0) return console.log('No requirement lists yet. Run: speckit-assistant import <file>');
    for (const s of sets) console.log(`${s.id}  ${s.title}  (${s.total} req, ${s.accepted} accepted, ${s.linked} in features)`);
    return;
  }
  const doc = await requirementsService.get(workspacePath, setId);
  if (!doc) throw new Error(`Requirement list not found: ${setId}`);
  console.log(`\n${doc.meta.title ?? setId}\n`);
  for (const r of doc.requirements) {
    console.log(`${r.id} [${r.status}] (${r.type}, ${r.priority}) ${r.title}${r.feature ? `  → ${r.feature}` : ''}`);
  }
}

async function createFeaturesFromRequirements(cmdArgs: string[]) {
  const setId = cmdArgs[0];
  if (!setId) throw new Error('Usage: create-features <list> [--single] [--all]');
  const doc = await requirementsService.get(workspacePath, setId);
  if (!doc) throw new Error(`Requirement list not found: ${setId}`);
  // --all includes drafts; by default only accepted requirements are built.
  const ids = doc.requirements
    .filter(r => !r.feature && r.priority !== 'wont' && (cmdArgs.includes('--all') ? r.status !== 'rejected' : r.status === 'accepted'))
    .map(r => r.id);
  if (ids.length === 0) throw new Error('No accepted requirements left to build (accept some, or pass --all).');

  let groups: FeatureGroup[];
  if (cmdArgs.includes('--single')) {
    const title = doc.meta.title || setId;
    groups = [{ name: slugify(title) || 'feature', title, requirementIds: ids }];
  } else {
    console.log(`Suggesting features for ${ids.length} requirement(s)...`);
    groups = (await featureCreationService.proposeGrouping(workspacePath, setId, ids)).groups;
  }
  for (const g of groups) console.log(`  • ${g.title} (${g.name}): ${g.requirementIds.join(', ')}`);

  const agent = activeAgent(await agentRepository.getAgents(workspacePath));
  if (!agent) throw new Error('No agent configured. Add one in the Agents section.');
  const result = await featureCreationService.createFeatures(workspacePath, setId, groups, toAgentConfig(agent), e => {
    if (e.type === 'start') console.log(`\n▶ ${e.title} → specs/${e.feature}`);
    else if (e.type === 'log') process.stdout.write(e.text);
    else if (e.type === 'done') console.log(`\n${e.ok ? '✅' : '❌'} ${e.message}`);
  });
  console.log(`\nCreated: ${result.created.join(', ') || 'none'}${result.failed.length ? `   Failed: ${result.failed.join(', ')}` : ''}`);
  if (result.failed.length) process.exitCode = 1;
}

async function createFeature(cmdArgs: string[]) {
  const name = cmdArgs[0];
  if (!name) throw new Error('Missing feature name. Usage: create <feature-name>');

  console.log(`Creating feature "${name}"...`);
  await workflowService.createFeature(workspacePath, name);
  console.log('✅ Feature folder created!');
}

async function deleteFeature(cmdArgs: string[]) {
  const name = cmdArgs[0];
  if (!name) throw new Error('Missing feature name. Usage: delete <feature-name>');

  console.log(`Deleting feature "${name}"...`);
  await workflowService.deleteFeature(workspacePath, name);
  console.log('✅ Feature folder deleted!');
}

async function runPhase(cmdArgs: string[]) {
  const phase = cmdArgs[0] as WorkflowPhase;
  if (!phase) throw new Error('Missing phase argument. Usage: run <phase> [feature] [options]');

  let feature: string | null = null;
  let nextArgIndex = 1;
  
  if (phase !== 'constitution') {
    if (cmdArgs[1] && !cmdArgs[1].startsWith('--')) {
      feature = cmdArgs[1];
      nextArgIndex = 2;
    } else {
      const state = await workflowService.getWorkflowState(workspacePath);
      feature = state.activeFeatureName;
      if (!feature) throw new Error('No active feature. Please specify feature name.');
    }
  }

  // Parse options
  const optArgs = cmdArgs.slice(nextArgIndex);
  const agentFlagIndex = optArgs.findIndex(arg => arg === '--agent');
  const agentType = agentFlagIndex !== -1 && optArgs[agentFlagIndex + 1] ? optArgs[agentFlagIndex + 1] as AgentType : 'claude';
  
  const promptFlagIndex = optArgs.findIndex(arg => arg === '--prompt');
  const promptText = promptFlagIndex !== -1 && optArgs[promptFlagIndex + 1] ? optArgs[promptFlagIndex + 1] : undefined;

  const agentConfig: AgentConfig = { agentType };

  console.log(`Running phase "${phase}"${feature ? ` for feature "${feature}"` : ''} using agent "${agentType}"...\n`);

  await workflowService.runPhase(
    workspacePath,
    phase,
    feature,
    agentConfig,
    promptText,
    (logData) => {
      process.stdout.write(logData);
    }
  );
  
  console.log('\n🏁 Phase run completed!');
}
