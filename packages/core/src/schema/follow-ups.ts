import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import type { FollowUpStatus } from '../types.js';
import { invites } from './invites.js';

export const follow_ups = sqliteTable('follow_ups', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  invite_id: integer('invite_id')
    .notNull()
    .references(() => invites.id, { onDelete: 'cascade' }),
  draft_text: text('draft_text').notNull(),
  generated_at: integer('generated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  approved_at: integer('approved_at', { mode: 'timestamp_ms' }),
  sent_at: integer('sent_at', { mode: 'timestamp_ms' }),
  status: text('status').notNull().$type<FollowUpStatus>().default('pending'),
});

export type FollowUp = typeof follow_ups.$inferSelect;
export type NewFollowUp = typeof follow_ups.$inferInsert;
