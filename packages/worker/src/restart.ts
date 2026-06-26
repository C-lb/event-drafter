import { getDb } from '@event-drafter/core/db';
import { jobs } from '@event-drafter/core/schema';
import type { JobKind } from '@event-drafter/core';
import { getSetting } from '@event-drafter/core/settings';
import { and, eq, notInArray } from 'drizzle-orm';
import { SEND_KINDS } from './poller.js';
import { runMissedRunCheck } from './scheduler.js';
import { logger } from './logger.js';

// Highest worker_restart_requested timestamp this process has already acted on.
// Lives in module scope so a soft restart fires exactly once per web request,
// not on every poll tick. Reset across process restarts (a real restart needs
// no soft restart anyway).
let _lastHandledTs = 0;

/** Test-only: forget the handled marker so a sequence can be re-exercised. */
export function __resetRestartStateForTest(): void {
  _lastHandledTs = 0;
}

/**
 * Honors a restart requested from the web UI (the `worker_restart_requested`
 * setting). Runs at the top of the poll loop, between ticks, where no job is
 * mid-flight in this process — so re-queuing stuck `running` rows is safe.
 *
 * Soft restart == re-run startup work without killing the process:
 *   1. Reset every stuck non-send job (`running`) back to `queued`. Send kinds
 *      are never touched, so this can't resurrect a half-finished send.
 *   2. Re-run the scheduler catch-up (check_replies / follow-ups / cleanup).
 *
 * Returns true iff a restart was handled this call.
 */
export function maybeHandleRestart(): boolean {
  const req = getSetting('worker_restart_requested');
  if (!req || req.ts <= _lastHandledTs) return false;
  _lastHandledTs = req.ts;

  const db = getDb();
  const reset = db
    .update(jobs)
    .set({ status: 'queued', started_at: null })
    .where(and(eq(jobs.status, 'running'), notInArray(jobs.kind, [...SEND_KINDS] as JobKind[])))
    .run();

  logger.info('worker soft restart', { requestedAt: req.ts, stuckRequeued: reset.changes });
  runMissedRunCheck();
  return true;
}
