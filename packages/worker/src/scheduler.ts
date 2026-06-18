import cron from 'node-cron';
import { getDb } from '@event-drafter/core/db';
import { jobs } from '@event-drafter/core/schema';
import type { JobKind } from '@event-drafter/core';
import { and, eq, gte, sql } from 'drizzle-orm';
import { logger } from './logger.js';

export const SCHEDULES = {
  evening_check: { cron: '0 10 * * *', kind: 'check_replies' as const, label: '06:00 PM SGT — check replies' },
  evening_followups: { cron: '5 10 * * *', kind: 'generate_follow_ups' as const, label: '06:05 PM SGT — generate follow-ups' },
  noon_check: { cron: '0 4 * * *', kind: 'check_replies' as const, label: '12:00 PM SGT — catch-up reply check' },
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
}
