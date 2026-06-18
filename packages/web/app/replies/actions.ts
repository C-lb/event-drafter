'use server';

import { z } from 'zod';
import { getDb } from '@vip/core/db';
import { replies, invites, contacts, events, jobs } from '@vip/core/schema';
import { eq, sql, and, inArray, isNull } from 'drizzle-orm';
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

const AUTO_CHECK_STALE_MS = 30 * 60 * 1000;

/**
 * Server-side "is the data stale?" check, designed to be invoked from Server
 * Components on page render. If no `check_replies` job is currently queued or
 * running AND the last successful check finished more than 30 minutes ago
 * (or none has ever completed), enqueues a fresh check.
 *
 * Idempotent and cheap (two indexed selects + at most one insert) — safe to
 * call on every page render. Paired with the `<AutoRefresh>` polling, this
 * keeps the operator's view current without manual button-clicking: a yes
 * contact who later sends "what time again?" lands in the dashboard within
 * one check cycle of the page being opened.
 */
export async function maybeEnqueueAutoReplyCheck(): Promise<void> {
  const db = getDb();

  const inFlight = db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.kind, 'check_replies'), inArray(jobs.status, ['queued', 'running'])))
    .get();
  if (inFlight) return;

  const lastDone = db
    .select({ finished_at: jobs.finished_at })
    .from(jobs)
    .where(and(eq(jobs.kind, 'check_replies'), eq(jobs.status, 'succeeded')))
    .orderBy(sql`${jobs.id} DESC`)
    .limit(1)
    .get();

  const finishedMs = lastDone?.finished_at instanceof Date
    ? lastDone.finished_at.getTime()
    : lastDone?.finished_at ? Number(lastDone.finished_at) : null;
  const stale = finishedMs === null || Date.now() - finishedMs > AUTO_CHECK_STALE_MS;
  if (!stale) return;

  db.insert(jobs).values({ kind: 'check_replies', payload: {}, status: 'queued' }).run();
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

export async function listAllReplies(opts: { includeResolved?: boolean } = {}) {
  const db = getDb();
  const base = db
    .select({
      reply_id: replies.id,
      event_id: invites.event_id,
      event_name: events.name,
      classification: replies.classification,
      confidence: replies.classification_confidence,
      summary: replies.classification_summary,
      reply_text: replies.wa_message_text,
      response_draft: replies.response_draft,
      response_status: replies.response_status,
      response_sent_at: replies.response_sent_at,
      wa_sent_at: replies.wa_sent_at,
      detected_at: replies.detected_at,
      resolved: replies.resolved,
      resolved_at: replies.resolved_at,
      contact_name: sql<string>`${contacts.first_name} || ' ' || COALESCE(${contacts.last_name}, '')`,
    })
    .from(replies)
    .innerJoin(invites, eq(replies.invite_id, invites.id))
    .innerJoin(contacts, eq(invites.contact_id, contacts.id))
    .innerJoin(events, eq(invites.event_id, events.id));

  const filtered = opts.includeResolved ? base : base.where(eq(replies.resolved, false));
  return filtered.orderBy(sql`${replies.detected_at} DESC`).limit(200).all();
}

export interface AwaitingInvite {
  invite_id: number;
  event_id: number;
  event_name: string;
  contact_name: string;
  sent_at: Date | null;
}

/**
 * VIPs who were sent an invite but haven't replied yet: invites in `sent`
 * status with no row in `replies`. Independent of the resolved toggle (these
 * have no reply to resolve). Ordered most-recently-invited first.
 */
export async function listAwaitingInvites(): Promise<AwaitingInvite[]> {
  const db = getDb();
  return db
    .select({
      invite_id: invites.id,
      event_id: invites.event_id,
      event_name: events.name,
      contact_name: sql<string>`${contacts.first_name} || ' ' || COALESCE(${contacts.last_name}, '')`,
      sent_at: invites.sent_at,
    })
    .from(invites)
    .innerJoin(contacts, eq(invites.contact_id, contacts.id))
    .innerJoin(events, eq(invites.event_id, events.id))
    .leftJoin(replies, eq(replies.invite_id, invites.id))
    .where(and(eq(invites.status, 'sent'), isNull(replies.id)))
    .orderBy(sql`${invites.sent_at} DESC`)
    .limit(300)
    .all();
}

const resolveSchema = z.object({
  reply_id: z.number().int().positive(),
  resolved: z.boolean(),
});

export async function setReplyResolved(input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = resolveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid input' };
  const { reply_id, resolved } = parsed.data;
  const db = getDb();
  db.update(replies)
    .set({ resolved, resolved_at: resolved ? new Date() : null })
    .where(eq(replies.id, reply_id))
    .run();
  revalidatePath('/replies');
  return { ok: true };
}

export async function resolvedReplyCount(): Promise<number> {
  const db = getDb();
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(replies)
    .where(eq(replies.resolved, true))
    .all()[0];
  return Number(row?.count ?? 0);
}
