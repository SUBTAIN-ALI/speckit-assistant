export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startEpsWorker } = await import('./adapters/epsRuntime');
    startEpsWorker();
  }
}
