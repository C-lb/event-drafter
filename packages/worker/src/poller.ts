import { getDb } from '@vip/core/db';
import { jobs } from '@vip/core/schema';
import type { Job, JobKind } from '@vip/core';
import { and, asc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { handlers } from './jobs/index.js';
import { logger } from './logger.js';

const STUCK_RUNNING_MS = 5 * 60 * 1000;

export async function tick(now: Date = new Date()): Promise<number> {
  const db = getDb();
  const stuckCutoff = new Date(now.getTime() - STUCK_RUNNING_MS);
  db.update(jobs)
    .set({ status: 'queued', started_at: null })
    .where(and(eq(jobs.status, 'running'), lte(jobs.started_at, stuckCutoff)))
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

  db.update(jobs)
    .set({ status: 'running', started_at: now, attempts: sql`${jobs.attempts} + 1` })
    .where(eq(jobs.id, job.id))
    .run();

  try {
    await handlers[job.kind as JobKind](job as Job);
    db.update(jobs)
      .set({ status: 'succeeded', finished_at: new Date(), last_error: null })
      .where(eq(jobs.id, job.id))
      .run();
  } catch (err) {
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
    const did = await tick();
    if (did === 0) await new Promise((r) => setTimeout(r, intervalMs));
  }
}
