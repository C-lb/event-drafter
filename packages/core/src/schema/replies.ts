import { sqliteTable, integer, text, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import type { ReplyClassification, ResponseStatus } from '../types.js';
import { invites } from './invites.js';

export const replies = sqliteTable('replies', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  invite_id: integer('invite_id')
    .notNull()
    .references(() => invites.id, { onDelete: 'cascade' }),
  wa_message_text: text('wa_message_text').notNull(),
  wa_sent_at: integer('wa_sent_at', { mode: 'timestamp_ms' }).notNull(),
  detected_at: integer('detected_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  classification: text('classification').$type<ReplyClassification>(),
  classification_confidence: real('classification_confidence'),
  classification_summary: text('classification_summary'),
  response_draft: text('response_draft'),
  response_approved_at: integer('response_approved_at', { mode: 'timestamp_ms' }),
  response_sent_at: integer('response_sent_at', { mode: 'timestamp_ms' }),
  response_status: text('response_status').$type<ResponseStatus>().default('pending'),
});

export type Reply = typeof replies.$inferSelect;
export type NewReply = typeof replies.$inferInsert;
