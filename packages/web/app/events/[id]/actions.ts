'use server';

import { z } from 'zod';
import { getDb } from '@vip/core/db';
import { contacts, events, invites, jobs } from '@vip/core/schema';
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
      contact_name: contacts.full_name,
      preferred_name: contacts.preferred_name,
      phone_e164: contacts.phone_e164,
      personal_note: contacts.personal_note,
    })
    .from(invites)
    .innerJoin(contacts, eq(invites.contact_id, contacts.id))
    .where(eq(invites.event_id, event_id))
    .orderBy(contacts.full_name)
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
    ? or(like(contacts.full_name, `%${search}%`), like(contacts.interests, `%${search}%`))
    : sql`1=1`;

  const whereExpr = alreadyInvited.length
    ? and(baseFilter, notInArray(contacts.id, alreadyInvited))
    : baseFilter;

  return db.select().from(contacts).where(whereExpr).orderBy(contacts.full_name).all();
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
