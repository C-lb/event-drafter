import { sqliteTable, integer, text, real, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import type { ReplyClassification, ResponseStatus, ClassificationSource } from '../types.js';
import { invites } from './invites.js';

export const replies = sqliteTable(
  'replies',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    invite_id: integer('invite_id')
      .notNull()
      .references(() => invites.id, { onDelete: 'cascade' }),
    wa_message_id: text('wa_message_id'),
    wa_message_text: text('wa_message_text').notNull(),
    wa_sent_at: integer('wa_sent_at', { mode: 'timestamp_ms' }).notNull(),
    detected_at: integer('detected_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    classification: text('classification').$type<ReplyClassification>(),
    classification_confidence: real('classification_confidence'),
    classification_summary: text('classification_summary'),
    classification_source: text('classification_source')
      .$type<ClassificationSource>()
      .notNull()
      .default('llm'),
    response_draft: text('response_draft'),
    response_approved_at: integer('response_approved_at', { mode: 'timestamp_ms' }),
    response_prefilled_at: integer('response_prefilled_at', { mode: 'timestamp_ms' }),
    response_sent_at: integer('response_sent_at', { mode: 'timestamp_ms' }),
    response_status: text('response_status').$type<ResponseStatus>().default('pending'),
    // Operator-facing "this thread is done with, hide from the feed". Independent
    // of response_status so a row can be auto-sent + marked resolved separately.
    resolved: integer('resolved', { mode: 'boolean' }).notNull().default(false),
    resolved_at: integer('resolved_at', { mode: 'timestamp_ms' }),
  },
  (t) => ({
    inviteMessageIdx: uniqueIndex('replies_invite_msg_idx').on(t.invite_id, t.wa_message_id),
  }),
);

export type Reply = typeof replies.$inferSelect;
export type NewReply = typeof replies.$inferInsert;
