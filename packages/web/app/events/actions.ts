'use server';

import { z } from 'zod';
import { getDb } from '@vip/core/db';
import { events, invites, replies } from '@vip/core/schema';
import { desc, eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { listRecentMessages, fetchMessage } from '@vip/worker/google/gmail';

export async function listEvents() {
  const db = getDb();
  return db.select().from(events).orderBy(desc(events.created_at)).all();
}

export async function listEventsWithStats() {
  const db = getDb();
  const rows = db
    .select({
      id: events.id,
      name: events.name,
      event_date: events.event_date,
      venue: events.venue,
      status: events.status,
      total_invites: sql<number>`COUNT(${invites.id})`,
      sent_invites: sql<number>`SUM(CASE WHEN ${invites.status} = 'sent' THEN 1 ELSE 0 END)`,
      replied: sql<number>`COUNT(DISTINCT CASE WHEN ${replies.id} IS NOT NULL THEN ${invites.id} END)`,
    })
    .from(events)
    .leftJoin(invites, eq(invites.event_id, events.id))
    .leftJoin(replies, eq(replies.invite_id, invites.id))
    .groupBy(events.id)
    .orderBy(desc(events.event_date))
    .all();

  return rows.map((r) => ({
    ...r,
    total_invites: Number(r.total_invites ?? 0),
    sent_invites: Number(r.sent_invites ?? 0),
    replied: Number(r.replied ?? 0),
    not_replied: Math.max(0, Number(r.sent_invites ?? 0) - Number(r.replied ?? 0)),
  }));
}

export async function searchInbox(query: string) {
  return listRecentMessages(query || 'newer_than:30d', 30);
}

export async function previewGmailMessage(id: string) {
  const msg = await fetchMessage(id);
  return {
    id: msg.id,
    from: msg.from,
    subject: msg.subject,
    internal_date: msg.internal_date,
    body_text: msg.body_text,
  };
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

const updateSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(200),
  event_date: z.string().min(1),
  venue: z.string().max(200).optional().or(z.literal('')),
  edm_subject: z.string().max(300).optional().or(z.literal('')),
  edm_body: z.string().max(20000).optional().or(z.literal('')),
});

export async function updateEvent(input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid input' };
  const { id, name, event_date, venue, edm_subject, edm_body } = parsed.data;

  const date = new Date(event_date);
  if (Number.isNaN(date.getTime())) return { ok: false, error: 'Invalid date.' };

  const db = getDb();
  db.update(events)
    .set({
      name: name.trim(),
      event_date: date,
      venue: venue?.trim() || null,
      edm_subject: edm_subject?.trim() || null,
      edm_body: edm_body?.trim() || null,
    })
    .where(eq(events.id, id))
    .run();
  revalidatePath('/events');
  revalidatePath(`/events/${id}`);
  return { ok: true };
}

const deleteSchema = z.object({
  id: z.number().int().positive(),
  confirm_phrase: z.string(),
});

export async function deleteEvent(input: unknown): Promise<{ ok: true; cascaded: number } | { ok: false; error: string }> {
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid input' };
  const { id, confirm_phrase } = parsed.data;

  const db = getDb();
  const ev = db.select().from(events).where(eq(events.id, id)).get();
  if (!ev) return { ok: false, error: 'Event not found.' };
  if (confirm_phrase !== ev.name) {
    return { ok: false, error: `Confirmation must match the event name exactly: "${ev.name}"` };
  }

  const inviteCount = db
    .select({ n: sql<number>`count(*)` })
    .from(invites)
    .where(eq(invites.event_id, id))
    .get();
  db.delete(events).where(eq(events.id, id)).run();
  revalidatePath('/events');
  return { ok: true, cascaded: Number(inviteCount?.n ?? 0) };
}
