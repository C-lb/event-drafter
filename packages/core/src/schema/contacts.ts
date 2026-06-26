import { sqliteTable, integer, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const contacts = sqliteTable(
  'contacts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    first_name: text('first_name').notNull(),
    last_name: text('last_name'),
    phone_e164: text('phone_e164').notNull(),
    secondary_phone_e164: text('secondary_phone_e164'),
    email: text('email'),
    remarks: text('remarks'),
    sheet_row_hash: text('sheet_row_hash'),
    // 1-based row number in the source sheet (header offset included), so the
    // operator's serial numbers match what they see in Google Sheets. Null for
    // hand-added contacts that never came from a sheet.
    sheet_row_index: integer('sheet_row_index'),
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
