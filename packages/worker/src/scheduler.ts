import cron from 'node-cron';
import { getDb } from '@event-drafter/core/db';
import { jobs } from '@event-drafter/core/schema';
import type { JobKind } from '@event-drafter/core';
import { getTimingConfig, TIMING_TZ } from '@event-drafter/core/settings';
import { and, eq, gte, sql } from 'drizzle-orm';
import { logger } from './logger.js';

// Static crons that are NOT operator-tunable. Reply-check times are dynamic and
// live in timing_config (settings), enqueued by the minute-ticker below.
export const SCHEDULES = {
  evening_followups: { cron: '5 10 * * *', kind: 'generate_follow_ups' as const, label: '06:05 PM SGT — generate follow-ups' },
  nightly_cleanup: { cron: '0 19 * * *', kind: 'cleanup_jobs' as const, label: '03:00 AM SGT — prune succeeded jobs >30d' },
};

function hasJobCreatedToday(kind: JobKind): boolean {
  const db = getDb();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(jobs)
    .where(and(eq(jobs.kind, kind), gte(jobs.created_at, startOfDay)))
    .all()[0];
  return (row?.count ?? 0) > 0;
}

function enqueue(kind: JobKind): void {
  const db = getDb();
  db.insert(jobs).values({ kind, payload: {} }).run();
  logger.info('scheduler: enqueued', { kind });
}

/** Reply-check times for the /status display, straight from settings. */
export function getReplyCheckSchedule(): Array<{ time: string; label: string; kind: 'check_replies' }> {
  return getTimingConfig().reply_check_times.map((t) => ({
    time: t,
    label: `${t} SGT — check replies`,
    kind: 'check_replies' as const,
  }));
}

function parseHHMM(s: string): number {
  const [h, m] = s.split(':');
  return Number(h) * 60 + Number(m);
}

/** Wall-clock hour/minute/second in the reply-check timezone, whatever the
 *  server's own timezone is. */
function tzParts(now: Date): { hour: number; minute: number; second: number } {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMING_TZ,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  let hour = get('hour');
  if (hour === 24) hour = 0; // some ICU builds emit 24 at midnight
  return { hour, minute: get('minute'), second: get('second') };
}

/**
 * The absolute instant of the most recent configured reply-check time that is
 * already due today (in TIMING_TZ), or null if none is due yet. Used both to
 * decide whether to enqueue and to detect whether a check already ran for it.
 */
function replyCheckDueInstant(now: Date): Date | null {
  const times = getTimingConfig().reply_check_times.map(parseHHMM).sort((a, b) => a - b);
  const { hour, minute, second } = tzParts(now);
  const nowMin = hour * 60 + minute;

  let due: number | null = null;
  for (const t of times) if (t <= nowMin) due = t;
  if (due === null) return null;

  const msSinceMidnight = (hour * 60 + minute) * 60_000 + second * 1000 + now.getMilliseconds();
  const tzMidnight = now.getTime() - msSinceMidnight;
  return new Date(tzMidnight + due * 60_000);
}

function hasCheckSince(instant: Date): boolean {
  const db = getDb();
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(jobs)
    .where(and(eq(jobs.kind, 'check_replies'), gte(jobs.created_at, instant)))
    .all()[0];
  return (row?.count ?? 0) > 0;
}

/**
 * Enqueue a check_replies job if a configured time is due today and no check has
 * run since that time. Idempotent within the window (the "since" guard), and
 * self-healing: if the worker was down over a scheduled time it fires once on
 * the next tick. Reads settings live, so changing the times applies within a
 * minute with no restart.
 */
export function maybeEnqueueReplyCheck(now: Date = new Date()): void {
  const due = replyCheckDueInstant(now);
  if (!due) return;
  if (hasCheckSince(due)) return;
  enqueue('check_replies');
  logger.info('scheduler: reply check due, enqueued', { due: due.toISOString() });
}

export function runMissedRunCheck(): void {
  const checked = new Set<string>();
  for (const s of Object.values(SCHEDULES)) {
    if (checked.has(s.kind)) continue;
    checked.add(s.kind);
    if (!hasJobCreatedToday(s.kind)) {
      logger.info('scheduler: missed run, catching up', { kind: s.kind });
      enqueue(s.kind);
    }
  }
  // Catch up a missed reply check immediately (don't wait for the next minute tick).
  maybeEnqueueReplyCheck();
}

export function startScheduler(): void {
  for (const [name, s] of Object.entries(SCHEDULES)) {
    if (!cron.validate(s.cron)) throw new Error(`bad cron expr for ${name}: ${s.cron}`);
    cron.schedule(s.cron, () => {
      logger.info('scheduler: tick', { name, kind: s.kind });
      enqueue(s.kind);
    });
    logger.info('scheduler: registered', { name, cron: s.cron, kind: s.kind, label: s.label });
  }
  // Dynamic reply checks: evaluate configured times once a minute.
  cron.schedule('* * * * *', () => maybeEnqueueReplyCheck());
  logger.info('scheduler: reply-check ticker registered', { times: getTimingConfig().reply_check_times });
}
