'use server';

import { getDb } from '@vip/core/db';
import { replies, invites, contacts, events } from '@vip/core/schema';
import { eq, sql } from 'drizzle-orm';

export async function listAllReplies() {
  const db = getDb();
  return db
    .select({
      reply_id: replies.id,
      event_id: invites.event_id,
      event_name: events.name,
      classification: replies.classification,
      summary: replies.classification_summary,
      reply_text: replies.wa_message_text,
      response_status: replies.response_status,
      detected_at: replies.detected_at,
      contact_name: contacts.full_name,
    })
    .from(replies)
    .innerJoin(invites, eq(replies.invite_id, invites.id))
    .innerJoin(contacts, eq(invites.contact_id, contacts.id))
    .innerJoin(events, eq(invites.event_id, events.id))
    .orderBy(sql`${replies.detected_at} DESC`)
    .limit(200)
    .all();
}
