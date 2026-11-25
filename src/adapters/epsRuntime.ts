import { epsService } from './di';
import { getWorkspacePath } from './primary/api/utils';

// One timer per Node server process, independent of browser tabs. The file lock
// also coordinates development reloads / multiple server processes.
const runtime = globalThis as typeof globalThis & { epsTimer?: ReturnType<typeof setInterval>; epsTick?: () => Promise<void> };
let running = false;
runtime.epsTick = async () => {
  if (running) return;
  running = true;
  try {
    const ws = getWorkspacePath();
    const state = await epsService.view(ws);
    if (state.enabled && state.configured && !state.authBlocked) await epsService.sync(ws);
  } catch {
    // Detailed errors are persisted by the service and shown in the EPS panel.
  } finally { running = false; }
};
export function startEpsWorker() {
  if (runtime.epsTimer) return;
  runtime.epsTimer = setInterval(() => { void runtime.epsTick?.(); }, 120_000);
  runtime.epsTimer.unref?.();
  void runtime.epsTick?.();
}
