'use server';

import { z } from 'zod';
import { getDb } from '@vip/core/db';
import { contacts, events, follow_ups, invites, jobs } from '@vip/core/schema';
import { eq, sql } from 'drizzle-orm';

export async function listFollowUps() {
  const db = getDb();
  return db
    .select({
      follow_up_id: follow_ups.id,
      invite_id: invites.id,
      event_id: invites.event_id,
      event_name: events.name,
      contact_name: sql<string>`${contacts.first_name} || ' ' || COALESCE(${contacts.last_name}, '')`,
      contact_id: contacts.id,
      draft_text: follow_ups.draft_text,
      status: follow_ups.status,
      generated_at: follow_ups.generated_at,
      prefilled_at: follow_ups.prefilled_at,
      sent_at: follow_ups.sent_at,
    })
    .from(follow_ups)
    .innerJoin(invites, eq(follow_ups.invite_id, invites.id))
    .innerJoin(contacts, eq(invites.contact_id, contacts.id))
    .innerJoin(events, eq(invites.event_id, events.id))
    .orderBy(sql`${follow_ups.generated_at} DESC`)
    .all();
}

const schema = z.object({ follow_up_id: z.number() });

export async function approveFollowUp(input: unknown) {
  const { follow_up_id } = schema.parse(input);
  const db = getDb();
  db.transaction((tx) => {
    tx.update(follow_ups)
      .set({ status: 'approved', approved_at: new Date() })
      .where(eq(follow_ups.id, follow_up_id))
      .run();
    tx.insert(jobs).values({ kind: 'send_follow_up', payload: { follow_up_id } }).run();
  });
}

export async function skipFollowUp(input: unknown) {
  const { follow_up_id } = schema.parse(input);
  const db = getDb();
  db.update(follow_ups).set({ status: 'skipped' }).where(eq(follow_ups.id, follow_up_id)).run();
}

export async function markFollowUpSent(input: unknown) {
  const { follow_up_id } = schema.parse(input);
  const db = getDb();
  db.update(follow_ups)
    .set({ status: 'sent', sent_at: new Date() })
    .where(eq(follow_ups.id, follow_up_id))
    .run();
}

const editSchema = z.object({ follow_up_id: z.number(), draft_text: z.string().min(1).max(2000) });
export async function editFollowUp(input: unknown) {
  const { follow_up_id, draft_text } = editSchema.parse(input);
  const db = getDb();
  db.update(follow_ups).set({ draft_text }).where(eq(follow_ups.id, follow_up_id)).run();
}

export async function triggerFollowUpGeneration() {
  const db = getDb();
  db.insert(jobs).values({ kind: 'generate_follow_ups', payload: {} }).run();
}
