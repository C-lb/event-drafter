'use server';

import { z } from 'zod';
import { getDb } from '@vip/core/db';
import { events } from '@vip/core/schema';
import { desc } from 'drizzle-orm';
import { listRecentMessages, fetchMessage } from '@vip/worker/google/gmail';

export async function listEvents() {
  const db = getDb();
  return db.select().from(events).orderBy(desc(events.created_at)).all();
}

export async function searchInbox(query: string) {
  return listRecentMessages(query || 'newer_than:30d', 20);
}

const createSchema = z.object({
  gmail_message_id: z.string().min(1),
  name: z.string().min(1),
  event_date: z.string(),
  venue: z.string().optional(),
});

export async function createEventFromMessage(input: unknown) {
  const { gmail_message_id, name, event_date, venue } = createSchema.parse(input);
  const msg = await fetchMessage(gmail_message_id);
  const db = getDb();
  const row = db
    .insert(events)
    .values({
      name,
      event_date: new Date(event_date),
      venue: venue ?? null,
      edm_subject: msg.subject,
      edm_body: msg.body_text,
      gmail_message_id: msg.id,
      status: 'draft',
    })
    .returning()
    .get();
  return { id: row.id };
}
