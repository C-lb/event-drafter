// Runs once when the Next server process starts. Auto-starts the background
// worker so the browser workflow needs no terminal. Guarded to the Node runtime
// and wrapped so a failure here never blocks the server from booting.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  try {
    const { ensureWorkerRunning } = await import('./lib/worker-process');
    ensureWorkerRunning();
  } catch {
    /* worker auto-start is best-effort; the UI Start button is the fallback */
  }
}
