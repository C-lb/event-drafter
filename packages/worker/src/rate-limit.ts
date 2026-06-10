import { getDb } from '@vip/core/db';
import { jobs } from '@vip/core/schema';
import { and, eq, gte, sql } from 'drizzle-orm';

const MAX_SENDS_PER_HOUR = 30;
const MIN_GAP_MS = 15_000;
const MAX_GAP_MS = 45_000;

/** Random gap in ms within [MIN_GAP_MS, MAX_GAP_MS]. */
export function jitterMs(): number {
  return MIN_GAP_MS + Math.floor(Math.random() * (MAX_GAP_MS - MIN_GAP_MS + 1));
}

/**
 * Returns null if a new send is allowed now, or a delay in ms until the
 * next send becomes allowed.
 */
export function sendDelayMs(now: Date = new Date()): number | null {
  const db = getDb();
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  const countRow = db
    .select({ count: sql<number>`count(*)` })
    .from(jobs)
    .where(
      and(
        eq(jobs.kind, 'send_message'),
        eq(jobs.status, 'succeeded'),
        gte(jobs.finished_at, hourAgo),
      ),
    )
    .all()[0];
  const count = countRow?.count ?? 0;

  if (count >= MAX_SENDS_PER_HOUR) {
    const oldest = db
      .select({ finished_at: jobs.finished_at })
      .from(jobs)
      .where(
        and(
          eq(jobs.kind, 'send_message'),
          eq(jobs.status, 'succeeded'),
          gte(jobs.finished_at, hourAgo),
        ),
      )
      .orderBy(jobs.finished_at)
      .limit(1)
      .all();
    const oldestMs = (oldest[0]?.finished_at as Date | undefined)?.getTime();
    if (oldestMs) {
      const delay = oldestMs + 60 * 60 * 1000 - now.getTime() + 1000;
      return Math.max(delay, 60_000);
    }
    return 60 * 60 * 1000;
  }

  const last = db
    .select({ finished_at: jobs.finished_at })
    .from(jobs)
    .where(and(eq(jobs.kind, 'send_message'), eq(jobs.status, 'succeeded')))
    .orderBy(sql`${jobs.finished_at} DESC`)
    .limit(1)
    .all()[0];

  if (last?.finished_at) {
    const since = now.getTime() - (last.finished_at as Date).getTime();
    if (since < MIN_GAP_MS) return MIN_GAP_MS - since;
  }

  return null;
}
