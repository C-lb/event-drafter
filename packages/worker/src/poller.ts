import { getDb } from '@event-drafter/core/db';
import { jobs } from '@event-drafter/core/schema';
import type { Job, JobKind } from '@event-drafter/core';
import { and, asc, eq, isNull, lte, notInArray, or, sql } from 'drizzle-orm';
import { handlers } from './jobs/index.js';
import { logger } from './logger.js';
import { JobDeferred } from './errors.js';
import { beat } from './heartbeat.js';

const STUCK_RUNNING_MS = 5 * 60 * 1000;

// Job kinds that actually deliver a WhatsApp message. A stuck one of these is
// NEVER auto-reset: if it was mid-send when it stalled, re-queueing it could
// fire the same message twice. The per-record send claim (status='sending')
// guards the message itself; this guards the job from blind retry. A genuinely
// stuck send is left 'running' for the operator to inspect.
const SEND_KINDS: ReadonlySet<JobKind> = new Set([
  'send_message',
  'send_follow_up',
  'send_response',
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

  const next = db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.status, 'queued'),
        or(isNull(jobs.run_after), lte(jobs.run_after, now)),
      ),
    )
    .orderBy(asc(jobs.created_at))
    .limit(1)
    .all();

  const job = next[0];
  if (!job) return 0;

  // Lost the race to another poller — it's already running elsewhere. Skip.
  if (!tryClaimJob(job.id, now)) return 1;

  try {
    await handlers[job.kind as JobKind](job as Job);
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
      return 1;
    }
    const msg = err instanceof Error ? err.stack ?? err.message : String(err);
    logger.error('job failed', { jobId: job.id, kind: job.kind, err: msg });
    db.update(jobs)
      .set({ status: 'failed', finished_at: new Date(), last_error: msg })
      .where(eq(jobs.id, job.id))
      .run();
  }

  return 1;
}

export async function runForever(intervalMs = 1000): Promise<void> {
  logger.info('worker poller started', { intervalMs });
  while (true) {
    beat();
    const did = await tick();
    if (did === 0) await new Promise((r) => setTimeout(r, intervalMs));
  }
}
