import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import type { EventStatus } from '../types.js';

export const events = sqliteTable('events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  event_date: integer('event_date', { mode: 'timestamp_ms' }).notNull(),
  venue: text('venue'),
  // Free-text operator note, editable sticky-note style on the home dashboard.
  note: text('note'),
  edm_subject: text('edm_subject'),
  edm_body: text('edm_body'),
  edm_summary: text('edm_summary'),
  draft_overrides: text('draft_overrides', { mode: 'json' }).$type<Partial<Record<string, string>>>(),
  gmail_message_id: text('gmail_message_id'),
  // Google Sheet link for this event's delegate tracker. Set by the operator
  // after the event is created; a yes-confirmation shifts that delegate's row
  // into the confirmed block. Nullable — no tracker until a link is set.
  delegate_sheet_url: text('delegate_sheet_url'),
  status: text('status').notNull().$type<EventStatus>().default('draft'),
  created_at: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
