'use server';

import { setSetting } from '@event-drafter/core/settings';
import { spawnWorker, killWorker, isWorkerAlive } from '@/lib/worker-process';

export interface WorkerActionResult {
  ok: boolean;
  status: 'started' | 'already-running' | 'stopped' | 'not-running' | 'failed';
  message?: string;
}

/** Start the worker (and re-enable auto-start). Idempotent: the worker's
 *  singleton lock means a redundant spawn just exits. */
export async function startWorker(): Promise<WorkerActionResult> {
  try {
    setSetting('worker_autostart', true);
  } catch {
    /* ignore */
  }
  if (isWorkerAlive()) return { ok: true, status: 'already-running' };
  const r = spawnWorker();
  if (!r.ok) return { ok: false, status: 'failed', message: r.message };
  return { ok: true, status: r.started ? 'started' : 'already-running' };
}

/** Stop the worker and disable auto-start so a web restart won't revive it. */
export async function stopWorker(): Promise<WorkerActionResult> {
  try {
    setSetting('worker_autostart', false);
  } catch {
    /* ignore */
  }
  const r = killWorker();
  if (!r.ok) return { ok: false, status: 'failed', message: r.message };
  return { ok: true, status: r.stopped ? 'stopped' : 'not-running' };
}
