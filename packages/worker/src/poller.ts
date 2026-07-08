import { getDb } from '@event-drafter/core/db';
import { jobs } from '@event-drafter/core/schema';
import type { Job, JobKind } from '@event-drafter/core';
import { and, asc, eq, isNull, lte, notInArray, or, sql } from 'drizzle-orm';
import { handlers } from './jobs/index.js';
import { logger } from './logger.js';
import { JobDeferred } from './errors.js';
import { beat } from './heartbeat.js';
import { maybeHandleRestart } from './restart.js';
import { getSetting } from '@event-drafter/core/settings';

const STUCK_RUNNING_MS = 5 * 60 * 1000;

/** True while the operator has engaged the emergency safety stop. */
export function isSafetyStopped(): boolean {
  return getSetting('worker_safety_stop')?.engaged === true;
}

// How many non-send (drafting / LLM) jobs to run concurrently per tick. Drafting
// has no human-pacing constraint, so a batch of N invites becomes ceil(N/K) waves
// of API round-trips instead of N serial ones. SQLite writes stay safe: each
// handler awaits its own network I/O, and better-sqlite3 statements are atomic.
// Read per-tick so the operator can tune ED_DRAFT_CONCURRENCY without a restart.
function draftConcurrency(): number {
  const n = Number(process.env.ED_DRAFT_CONCURRENCY ?? 4);
  return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 4;
}

// Job kinds that actually deliver a WhatsApp message. A stuck one of these is
// NEVER auto-reset: if it was mid-send when it stalled, re-queueing it could
// fire the same message twice. The per-record send claim (status='sending')
// guards the message itself; this guards the job from blind retry. A genuinely
// stuck send is left 'running' for the operator to inspect.
export const SEND_KINDS: ReadonlySet<JobKind> = new Set([
  'send_message',
  'send_follow_up',
  'send_response',
  'send_reaction',
  'auto_respond',
]);

/**
 * Atomically transition one queued job to running. The `status = 'queued'`
 * guard makes this a compare-and-swap: if two pollers race the same row, only
 * the UPDATE that finds it still queued matches, so exactly one wins. Returns
 * true iff THIS caller claimed it; a loser gets false and must not run it.
 */
export function tryClaimJob(jobId: number, now: Date = new Date()): boolean {
  const res = getDb()
    .update(jobs)
    .set({ status: 'running', started_at: now, attempts: sql`${jobs.attempts} + 1` })
    .where(and(eq(jobs.id, jobId), eq(jobs.status, 'queued')))
    .run();
  return res.changes === 1;
}

export async function tick(now: Date = new Date()): Promise<number> {
  const db = getDb();
  const stuckCutoff = new Date(now.getTime() - STUCK_RUNNING_MS);
  db.update(jobs)
    .set({ status: 'queued', started_at: null })
    .where(
      and(
        eq(jobs.status, 'running'),
        lte(jobs.started_at, stuckCutoff),
        notInArray(jobs.kind, [...SEND_KINDS]),
      ),
    )
    .run();

  const eligible = and(
    eq(jobs.status, 'queued'),
    or(isNull(jobs.run_after), lte(jobs.run_after, now)),
  );

  // Peek at the oldest eligible job to decide the processing mode.
  const head = db.select().from(jobs).where(eligible).orderBy(asc(jobs.created_at)).limit(1).all()[0];
  if (!head) return 0;

  // Send kinds deliver a real WhatsApp message: they run strictly one-at-a-time
  // to preserve ordering and the per-record double-send guard. Never batched.
  if (SEND_KINDS.has(head.kind as JobKind)) {
    if (!tryClaimJob(head.id, now)) return 1; // lost the race — running elsewhere
    await runJob(head as Job, now);
    return 1;
  }

  // Non-send (drafting / LLM) kinds: claim and run a bounded concurrent batch of
  // the oldest eligible non-send jobs.
  const batch = db
    .select()
    .from(jobs)
    .where(and(eligible, notInArray(jobs.kind, [...SEND_KINDS])))
    .orderBy(asc(jobs.created_at))
    .limit(draftConcurrency())
    .all();

  const claimed = batch.filter((j) => tryClaimJob(j.id, now));
  if (claimed.length === 0) return 1; // all lost the race — something is running
  await Promise.all(claimed.map((j) => runJob(j as Job, now)));
  return claimed.length;
}

/**
 * Run a single already-claimed job to completion, recording its terminal status.
 * A `JobDeferred` re-queues the job with a future `run_after` (and rolls back the
 * attempt the claim charged), so deferral never counts against the retry budget.
 */
async function runJob(job: Job, now: Date): Promise<void> {
  const db = getDb();
  try {
    await handlers[job.kind as JobKind](job);
    db.update(jobs)
      .set({ status: 'succeeded', finished_at: new Date(), last_error: null })
      .where(eq(jobs.id, job.id))
      .run();
  } catch (err) {
    if (err instanceof JobDeferred) {
      const runAfter = new Date(now.getTime() + err.delayMs);
      logger.info('job deferred', { jobId: job.id, kind: job.kind, delayMs: err.delayMs });
      db.update(jobs)
        .set({
          status: 'queued',
          started_at: null,
          attempts: sql`${jobs.attempts} - 1`,
          run_after: runAfter,
          last_error: null,
        })
        .where(eq(jobs.id, job.id))
        .run();
      return;
    }
    const msg = err instanceof Error ? err.stack ?? err.message : String(err);
    logger.error('job failed', { jobId: job.id, kind: job.kind, err: msg });
    db.update(jobs)
      .set({ status: 'failed', finished_at: new Date(), last_error: msg })
      .where(eq(jobs.id, job.id))
      .run();
  }
}

export async function runForever(intervalMs = 1000): Promise<void> {
  logger.info('worker poller started', { intervalMs });
  while (true) {
    beat();
    if (isSafetyStopped()) {
      await new Promise((r) => setTimeout(r, intervalMs));
      continue;
    }
    // Honor a web-requested soft restart between ticks (no job in flight here).
    const restarted = maybeHandleRestart();
    const did = await tick();
    if (did === 0 && !restarted) await new Promise((r) => setTimeout(r, intervalMs));
  }
}
