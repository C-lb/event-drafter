import type { Job } from '@vip/core';
import { getDb } from '@vip/core/db';
import { jobs } from '@vip/core/schema';
import { and, eq, lt, ne, sql } from 'drizzle-orm';
import { logger } from '../logger.js';

const RETENTION_DAYS = 30;

export async function cleanupJobsHandler(_job: Job): Promise<void> {
  const db = getDb();
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 3600 * 1000);

  const succeededDeleted = db
    .delete(jobs)
    .where(and(eq(jobs.status, 'succeeded'), lt(jobs.created_at, cutoff), ne(jobs.kind, 'cleanup_jobs')))
    .run();

  logger.info('cleanup_jobs: done', {
    retention_days: RETENTION_DAYS,
    succeeded_deleted: succeededDeleted.changes,
  });
}
