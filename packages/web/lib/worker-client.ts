// Client-side helpers to observe the worker via the existing /api/worker/state
// endpoint. Used to confirm start/stop/restart actually took effect.

export async function workerConnected(): Promise<boolean> {
  try {
    const r = await fetch('/api/worker/state', { cache: 'no-store' });
    if (!r.ok) return false;
    const d = await r.json();
    return d.connected === true;
  } catch {
    return false;
  }
}

async function waitFor(pred: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await pred()) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

export const waitForWorkerUp = (timeoutMs: number) => waitFor(workerConnected, timeoutMs);
export const waitForWorkerDown = (timeoutMs: number) =>
  waitFor(async () => !(await workerConnected()), timeoutMs);
