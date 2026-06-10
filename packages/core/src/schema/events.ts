import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import type { EventStatus } from '../types.js';

export const events = sqliteTable('events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  event_date: integer('event_date', { mode: 'timestamp_ms' }).notNull(),
  venue: text('venue'),
  edm_subject: text('edm_subject'),
  edm_body: text('edm_body'),
  gmail_message_id: text('gmail_message_id'),
  status: text('status').notNull().$type<EventStatus>().default('draft'),
  created_at: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
