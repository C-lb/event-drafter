import { sqliteTable, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { contacts } from './contacts.js';

export const wa_chat_cursors = sqliteTable('wa_chat_cursors', {
  contact_id: integer('contact_id')
    .primaryKey()
    .references(() => contacts.id, { onDelete: 'cascade' }),
  last_seen_wa_sent_at: integer('last_seen_wa_sent_at', { mode: 'timestamp_ms' }).notNull(),
  updated_at: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export type WaChatCursor = typeof wa_chat_cursors.$inferSelect;
export type NewWaChatCursor = typeof wa_chat_cursors.$inferInsert;
