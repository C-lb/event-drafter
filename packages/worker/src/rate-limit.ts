import { getDb } from '@vip/core/db';
import { jobs } from '@vip/core/schema';
import { and, eq, gte, sql } from 'drizzle-orm';

// See CONTEXT.md → "Sending cadence". Numbers calibrated to mimic a human
// typing each message in WhatsApp Web. Do not lower without operator sign-off.

const MIN_GAP_MS = 179_000;             // 2:59 floor between consecutive sends
const MAX_GAP_MS = 5 * 60_000;          // upper bound on the randomised gap
const BATCH_LIMIT = 8;                  // after this many in a row, cool down
const COOLDOWN_MIN_MS = 15 * 60_000;    // 15 min cool-down between batches
const COOLDOWN_MAX_MS = 30 * 60_000;    // 30 min
const MAX_SENDS_PER_HOUR = 18;          // hard hourly safety cap

/** Random gap in ms within [MIN_GAP_MS, MAX_GAP_MS]. */
export function jitterMs(): number {
  return MIN_GAP_MS + Math.floor(Math.random() * (MAX_GAP_MS - MIN_GAP_MS + 1));
}

/** Random cool-down in ms within [COOLDOWN_MIN_MS, COOLDOWN_MAX_MS]. */
export function cooldownMs(): number {
  return COOLDOWN_MIN_MS + Math.floor(Math.random() * (COOLDOWN_MAX_MS - COOLDOWN_MIN_MS + 1));
}

/**
 * Counts consecutive succeeded send_message jobs walking back from `now`,
 * stopping at the first gap >= COOLDOWN_MIN_MS (which we interpret as a
 * batch break). Bounded scan of the last 50 sends.
 */
function consecutiveSendsInBatch(now: Date): number {
  const db = getDb();
  const rows = db
    .select({ finished_at: jobs.finished_at })
    .from(jobs)
    .where(and(eq(jobs.kind, 'send_message'), eq(jobs.status, 'succeeded')))
    .orderBy(sql`${jobs.finished_at} DESC`)
    .limit(50)
    .all();

  let count = 0;
  let prevMs: number | null = null;
  for (const r of rows) {
    const t = (r.finished_at as Date | undefined)?.getTime();
    if (!t) break;
    if (prevMs === null) {
      // gap from now → newest send. If we're already past a cool-down, batch is fresh.
      if (now.getTime() - t >= COOLDOWN_MIN_MS) return 0;
    } else {
      if (prevMs - t >= COOLDOWN_MIN_MS) break;
    }
    count++;
    prevMs = t;
  }
  return count;
}

/**
 * Returns null if a new send is allowed now, or a delay in ms until the
 * next send becomes allowed. Enforces three layers:
 *
 *   1. Hard hourly cap (MAX_SENDS_PER_HOUR)
 *   2. Batch cool-down (after BATCH_LIMIT consecutive sends)
 *   3. Per-message floor (MIN_GAP_MS)
 */
export function sendDelayMs(now: Date = new Date()): number | null {
  const db = getDb();
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  // 1. Hourly cap.
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

  // Most recent succeeded send.
  const last = db
    .select({ finished_at: jobs.finished_at })
    .from(jobs)
    .where(and(eq(jobs.kind, 'send_message'), eq(jobs.status, 'succeeded')))
    .orderBy(sql`${jobs.finished_at} DESC`)
    .limit(1)
    .all()[0];
  const lastMs = (last?.finished_at as Date | undefined)?.getTime();

  // 2. Batch cool-down.
  const inBatch = consecutiveSendsInBatch(now);
  if (inBatch >= BATCH_LIMIT && lastMs) {
    const since = now.getTime() - lastMs;
    if (since < COOLDOWN_MIN_MS) return COOLDOWN_MIN_MS - since;
  }

  // 3. Per-message floor.
  if (lastMs) {
    const since = now.getTime() - lastMs;
    if (since < MIN_GAP_MS) return MIN_GAP_MS - since;
  }

  return null;
}
