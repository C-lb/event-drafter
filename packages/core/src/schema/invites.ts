import { sqliteTable, integer, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import type { InviteStatus, Rsvp } from '../types.js';
import { events } from './events.js';
import { contacts } from './contacts.js';

export const invites = sqliteTable(
  'invites',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    event_id: integer('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    contact_id: integer('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    draft_text: text('draft_text'),
    draft_generated_at: integer('draft_generated_at', { mode: 'timestamp_ms' }),
    approved_at: integer('approved_at', { mode: 'timestamp_ms' }),
    sent_at: integer('sent_at', { mode: 'timestamp_ms' }),
    status: text('status').notNull().$type<InviteStatus>().default('pending'),
    rsvp: text('rsvp').notNull().$type<Rsvp>().default('none'),
    attended: integer('attended', { mode: 'boolean' }).notNull().default(false),
    attended_notes: text('attended_notes'),
    generation_meta: text('generation_meta', { mode: 'json' }).$type<Record<string, unknown>>(),
    created_at: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    eventContactIdx: uniqueIndex('invites_event_contact_idx').on(t.event_id, t.contact_id),
  }),
);

export type Invite = typeof invites.$inferSelect;
export type NewInvite = typeof invites.$inferInsert;
