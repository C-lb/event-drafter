'use server';

import { z } from 'zod';
import { getDb } from '@vip/core/db';
import { contacts, events, invites, jobs, replies } from '@vip/core/schema';
import { and, eq, like, notInArray, or, sql } from 'drizzle-orm';

export async function getEventOrThrow(id: number) {
  const db = getDb();
  const e = db.select().from(events).where(eq(events.id, id)).get();
  if (!e) throw new Error(`event ${id} not found`);
  return e;
}

export async function listInvitesForEvent(event_id: number) {
  const db = getDb();
  return db
    .select({
      invite_id: invites.id,
      status: invites.status,
      draft_text: invites.draft_text,
      sent_at: invites.sent_at,
      contact_id: contacts.id,
      first_name: contacts.first_name,
      last_name: contacts.last_name,
      phone_e164: contacts.phone_e164,
      remarks: contacts.remarks,
    })
    .from(invites)
    .innerJoin(contacts, eq(invites.contact_id, contacts.id))
    .where(eq(invites.event_id, event_id))
    .orderBy(contacts.first_name)
    .all();
}

const filterSchema = z.object({
  search: z.string().optional(),
  exclude_invited: z.boolean().default(true),
});

export async function listCandidatesForEvent(event_id: number, filter: unknown) {
  const { search, exclude_invited } = filterSchema.parse(filter);
  const db = getDb();

  let alreadyInvited: number[] = [];
  if (exclude_invited) {
    alreadyInvited = db
      .select({ id: invites.contact_id })
      .from(invites)
      .where(eq(invites.event_id, event_id))
      .all()
      .map((r) => r.id);
  }

  const baseFilter = search
    ? or(
        like(contacts.first_name, `%${search}%`),
        like(contacts.last_name, `%${search}%`),
        like(contacts.remarks, `%${search}%`),
      )
    : sql`1=1`;

  const whereExpr = alreadyInvited.length
    ? and(baseFilter, notInArray(contacts.id, alreadyInvited))
    : baseFilter;

  return db.select().from(contacts).where(whereExpr).orderBy(contacts.first_name).all();
}

const generateSchema = z.object({
  event_id: z.number(),
  contact_ids: z.array(z.number()).min(1),
});

export async function enqueueDraftsForContacts(input: unknown) {
  const { event_id, contact_ids } = generateSchema.parse(input);
  const db = getDb();
  db.transaction((tx) => {
    for (const cid of contact_ids) {
      tx.insert(invites)
        .values({ event_id, contact_id: cid, status: 'pending' })
        .onConflictDoNothing()
        .run();
      tx.insert(jobs).values({
        kind: 'draft_invite',
        payload: { event_id, contact_id: cid },
      }).run();
    }
    tx.update(events).set({ status: 'drafting' }).where(eq(events.id, event_id)).run();
  });
  return { enqueued: contact_ids.length };
}

const editSchema = z.object({ invite_id: z.number(), draft_text: z.string().min(1).max(2000) });
export async function editDraft(input: unknown) {
  const { invite_id, draft_text } = editSchema.parse(input);
  const db = getDb();
  db.update(invites).set({ draft_text }).where(eq(invites.id, invite_id)).run();
}

const approveSchema = z.object({ invite_id: z.number() });
export async function approveDraft(input: unknown) {
  const { invite_id } = approveSchema.parse(input);
  const db = getDb();
  db.transaction((tx) => {
    tx.update(invites)
      .set({ status: 'approved', approved_at: new Date() })
      .where(eq(invites.id, invite_id))
      .run();
    tx.insert(jobs).values({
      kind: 'send_message',
      payload: { invite_id },
    }).run();
  });
}

const markSentSchema = z.object({ invite_id: z.number() });

export async function markSent(input: unknown) {
  const { invite_id } = markSentSchema.parse(input);
  const db = getDb();
  db.update(invites)
    .set({ status: 'sent', sent_at: new Date() })
    .where(eq(invites.id, invite_id))
    .run();
}

export async function reprefill(input: unknown) {
  const { invite_id } = markSentSchema.parse(input);
  const db = getDb();
  db.transaction((tx) => {
    tx.update(invites)
      .set({ status: 'approved', prefilled_at: null })
      .where(eq(invites.id, invite_id))
      .run();
    tx.insert(jobs).values({ kind: 'send_message', payload: { invite_id } }).run();
  });
}

export async function skipDraft(input: unknown) {
  const { invite_id } = approveSchema.parse(input);
  const db = getDb();
  db.update(invites).set({ status: 'skipped' }).where(eq(invites.id, invite_id)).run();
}

export async function regenerateDraft(input: unknown) {
  const { invite_id } = approveSchema.parse(input);
  const db = getDb();
  const inv = db.select().from(invites).where(eq(invites.id, invite_id)).get();
  if (!inv) throw new Error('invite not found');
  db.insert(jobs).values({
    kind: 'draft_invite',
    payload: { event_id: inv.event_id, contact_id: inv.contact_id },
  }).run();
}

export async function triggerReplyCheck() {
  const db = getDb();
  db.insert(jobs).values({ kind: 'check_replies', payload: {} }).run();
}

export async function listRepliesForEvent(event_id: number) {
  const db = getDb();
  return db
    .select({
      reply_id: replies.id,
      classification: replies.classification,
      confidence: replies.classification_confidence,
      summary: replies.classification_summary,
      reply_text: replies.wa_message_text,
      response_draft: replies.response_draft,
      response_status: replies.response_status,
      response_prefilled_at: replies.response_prefilled_at,
      response_sent_at: replies.response_sent_at,
      contact_name: sql<string>`${contacts.first_name} || ' ' || COALESCE(${contacts.last_name}, '')`,
      contact_id: contacts.id,
    })
    .from(replies)
    .innerJoin(invites, eq(replies.invite_id, invites.id))
    .innerJoin(contacts, eq(invites.contact_id, contacts.id))
    .where(eq(invites.event_id, event_id))
    .orderBy(sql`${replies.detected_at} DESC`)
    .all();
}

const responseActionSchema = z.object({ reply_id: z.number() });

export async function approveResponse(input: unknown) {
  const { reply_id } = responseActionSchema.parse(input);
  const db = getDb();
  db.transaction((tx) => {
    tx.update(replies)
      .set({ response_status: 'approved', response_approved_at: new Date() })
      .where(eq(replies.id, reply_id))
      .run();
    tx.insert(jobs).values({ kind: 'send_response', payload: { reply_id } }).run();
  });
}

export async function skipResponse(input: unknown) {
  const { reply_id } = responseActionSchema.parse(input);
  const db = getDb();
  db.update(replies).set({ response_status: 'skipped' }).where(eq(replies.id, reply_id)).run();
}

export async function markResponseSent(input: unknown) {
  const { reply_id } = responseActionSchema.parse(input);
  const db = getDb();
  db.update(replies)
    .set({ response_status: 'sent', response_sent_at: new Date() })
    .where(eq(replies.id, reply_id))
    .run();
}

const editResponseSchema = z.object({ reply_id: z.number(), response_draft: z.string().min(1).max(2000) });
export async function editResponse(input: unknown) {
  const { reply_id, response_draft } = editResponseSchema.parse(input);
  const db = getDb();
  db.update(replies).set({ response_draft }).where(eq(replies.id, reply_id)).run();
}
