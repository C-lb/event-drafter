import { sqliteTable, integer, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const contacts = sqliteTable(
  'contacts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    full_name: text('full_name').notNull(),
    preferred_name: text('preferred_name'),
    phone_e164: text('phone_e164').notNull(),
    email: text('email'),
    personal_note: text('personal_note'),
    interests: text('interests'),
    relationship_notes: text('relationship_notes'),
    sheet_row_hash: text('sheet_row_hash'),
    created_at: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updated_at: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    phoneIdx: uniqueIndex('contacts_phone_idx').on(t.phone_e164),
  }),
);

export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
