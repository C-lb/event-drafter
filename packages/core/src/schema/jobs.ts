import { sqliteTable, integer, text, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import type { JobKind, JobStatus } from '../types.js';

export const jobs = sqliteTable(
  'jobs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    kind: text('kind').notNull().$type<JobKind>(),
    payload: text('payload', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
    status: text('status').notNull().$type<JobStatus>().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    last_error: text('last_error'),
    progress: text('progress'),
    run_after: integer('run_after', { mode: 'timestamp_ms' }),
    created_at: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    started_at: integer('started_at', { mode: 'timestamp_ms' }),
    finished_at: integer('finished_at', { mode: 'timestamp_ms' }),
  },
  (t) => ({
    statusRunAfterIdx: index('jobs_status_runafter_idx').on(t.status, t.run_after),
  }),
);

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
