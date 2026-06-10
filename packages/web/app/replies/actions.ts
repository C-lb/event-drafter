'use server';

import { getDb } from '@vip/core/db';
import { replies, invites, contacts, events, jobs } from '@vip/core/schema';
import { eq, sql, and, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

export async function triggerReplyCheck(): Promise<void> {
  const db = getDb();
  const existing = db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.kind, 'check_replies'), inArray(jobs.status, ['queued', 'running'])))
    .get();
  if (!existing) {
    db.insert(jobs).values({ kind: 'check_replies', payload: {}, status: 'queued' }).run();
  }
  revalidatePath('/replies');
}

export async function latestReplyCheck() {
  const db = getDb();
  return db
    .select({
      id: jobs.id,
      status: jobs.status,
      attempts: jobs.attempts,
      created_at: jobs.created_at,
      finished_at: jobs.finished_at,
      last_error: jobs.last_error,
    })
    .from(jobs)
    .where(eq(jobs.kind, 'check_replies'))
    .orderBy(sql`${jobs.id} DESC`)
    .limit(1)
    .get();
}

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
