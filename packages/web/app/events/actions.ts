'use server';

import { z } from 'zod';
import { getDb } from '@event-drafter/core/db';
import { events, invites, replies } from '@event-drafter/core/schema';
import { summarizeEdm } from '@event-drafter/core/edm-extract';
import { desc, eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { listRecentMessages, fetchMessage } from '@event-drafter/worker/google/gmail';
import { DELETE_CONFIRM_PHRASE } from './delete-confirm';

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
      note: events.note,
      status: events.status,
      total_invites: sql<number>`COUNT(DISTINCT ${invites.id})`,
      // "replied" counts distinct invites that have at least one reply, so a
      // thread with N messages still counts as 1 reply.
      replied: sql<number>`COUNT(DISTINCT CASE WHEN ${replies.id} IS NOT NULL THEN ${invites.id} END)`,
      // Classification breakdown — distinct invites whose latest reply
      // classifies that way. (Each invite has one reply row by design.)
      yes: sql<number>`COUNT(DISTINCT CASE WHEN ${replies.classification} = 'yes' THEN ${invites.id} END)`,
      no: sql<number>`COUNT(DISTINCT CASE WHEN ${replies.classification} = 'no' THEN ${invites.id} END)`,
      maybe: sql<number>`COUNT(DISTINCT CASE WHEN ${replies.classification} = 'maybe' THEN ${invites.id} END)`,
      unclear: sql<number>`COUNT(DISTINCT CASE WHEN ${replies.classification} = 'unclear' THEN ${invites.id} END)`,
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
    replied: Number(r.replied ?? 0),
    yes: Number(r.yes ?? 0),
    no: Number(r.no ?? 0),
    maybe: Number(r.maybe ?? 0),
    unclear: Number(r.unclear ?? 0),
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

const createBlankSchema = z.object({
  name: z.string().min(1).max(200),
  // Date is optional — only the title is mandatory. A blank date defaults to
  // now and can be set later from the event's edit panel.
  event_date: z.string().optional().or(z.literal('')),
  venue: z.string().max(200).optional().or(z.literal('')),
  edm_subject: z.string().max(300).optional().or(z.literal('')),
  edm_body: z.string().max(20000).optional().or(z.literal('')),
});

export async function createEventBlank(input: unknown): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const parsed = createBlankSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid input' };
  const { name, event_date, venue, edm_subject, edm_body } = parsed.data;

  // Blank → default to now (column is NOT NULL); a provided value must be valid.
  const date = event_date && event_date.trim() ? new Date(event_date) : new Date();
  if (Number.isNaN(date.getTime())) return { ok: false, error: 'Invalid date.' };

  const body = edm_body?.trim() ?? '';
  const subject = edm_subject?.trim() ?? '';
  const summary = body ? summarizeEdm(body, subject, date.getFullYear()) : '';

  const db = getDb();
  const row = db
    .insert(events)
    .values({
      name: name.trim(),
      event_date: date,
      venue: venue?.trim() || null,
      edm_subject: subject || null,
      edm_body: body || null,
      edm_summary: summary || null,
      gmail_message_id: null,
      status: 'draft',
    })
    .returning()
    .get();
  revalidatePath('/events');
  return { ok: true, id: row.id };
}

export async function createEventFromMessage(input: unknown) {
  const { gmail_message_id, name, event_date, venue } = createSchema.parse(input);
  const msg = await fetchMessage(gmail_message_id);
  const fallbackYear = new Date(event_date || msg.internal_date).getFullYear();
  const edmSummary = summarizeEdm(msg.body_text, msg.subject, fallbackYear);
  const db = getDb();
  const row = db
    .insert(events)
    .values({
      name,
      event_date: new Date(event_date),
      venue: venue ?? null,
      edm_subject: msg.subject,
      edm_body: msg.body_text,
      edm_summary: edmSummary || null,
      gmail_message_id: msg.id,
      status: 'draft',
    })
    .returning()
    .get();
  return { id: row.id };
}

export async function duplicateEvent(
  input: unknown,
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const id = typeof input === 'object' && input !== null ? (input as { id?: unknown }).id : input;
  if (!Number.isFinite(id) || (id as number) <= 0) return { ok: false, error: 'Invalid event id.' };

  const db = getDb();
  const src = db.select().from(events).where(eq(events.id, id as number)).get();
  if (!src) return { ok: false, error: 'Event not found.' };

  // Copy the reusable details only. A duplicate is a clean slate: no contacts,
  // invites, replies, or follow-ups, and no per-run fields (gmail provenance,
  // delegate tracker sheet) carry over.
  const row = db
    .insert(events)
    .values({
      name: `${src.name} (copy)`,
      event_date: src.event_date,
      venue: src.venue,
      note: src.note,
      edm_subject: src.edm_subject,
      edm_body: src.edm_body,
      edm_summary: src.edm_summary,
      draft_overrides: src.draft_overrides ?? null,
      gmail_message_id: null,
      delegate_sheet_url: null,
      status: 'draft',
    })
    .returning()
    .get();

  revalidatePath('/');
  revalidatePath('/events');
  return { ok: true, id: row.id };
}

const updateSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(200),
  event_date: z.string().min(1),
  venue: z.string().max(200).optional().or(z.literal('')),
  edm_subject: z.string().max(300).optional().or(z.literal('')),
  edm_body: z.string().max(20000).optional().or(z.literal('')),
  edm_summary: z.string().max(4000).optional().or(z.literal('')),
});

export async function updateEvent(input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid input' };
  const { id, name, event_date, venue, edm_subject, edm_body, edm_summary } = parsed.data;

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
      edm_summary: edm_summary?.trim() || null,
    })
    .where(eq(events.id, id))
    .run();
  revalidatePath('/events');
  revalidatePath(`/events/${id}`);
  return { ok: true };
}

const cardSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().trim().min(1, 'Name is required.').max(200),
  note: z.string().max(2000).optional(),
  event_date: z.string().min(1, 'Date is required.'),
});

/**
 * Lightweight inline update for the home "sticky note" cards: just the title,
 * the free-text note, and the date. Leaves EDM fields and everything else
 * untouched (unlike the full updateEvent form).
 */
export async function updateEventCard(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = cardSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid input' };
  const { id, name, note, event_date } = parsed.data;

  const date = new Date(event_date);
  if (Number.isNaN(date.getTime())) return { ok: false, error: 'Invalid date.' };

  const db = getDb();
  db.update(events)
    .set({ name: name.trim(), note: note?.trim() || null, event_date: date })
    .where(eq(events.id, id))
    .run();
  revalidatePath('/');
  revalidatePath('/events');
  revalidatePath(`/events/${id}`);
  return { ok: true };
}

const DRAFT_KINDS = ['long_invite', 'day_of_reminder', 'gentle_follow_up'] as const;
type DraftKind = (typeof DRAFT_KINDS)[number];

const overrideSchema = z.object({
  event_id: z.number().int().positive(),
  kind: z.enum(DRAFT_KINDS),
  body: z.string().max(4000),
});

export async function saveDraftOverride(input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = overrideSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid input' };
  const { event_id, kind, body } = parsed.data;
  const db = getDb();
  const row = db.select().from(events).where(eq(events.id, event_id)).get();
  if (!row) return { ok: false, error: 'Event not found.' };
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, error: 'Draft body cannot be empty. Use Reset to template if you want to clear edits.' };
  const next: Partial<Record<DraftKind, string>> = { ...(row.draft_overrides ?? {}) };
  next[kind] = trimmed;
  db.update(events).set({ draft_overrides: next }).where(eq(events.id, event_id)).run();
  revalidatePath(`/events/${event_id}`);
  return { ok: true };
}

const resetSchema = z.object({
  event_id: z.number().int().positive(),
  kind: z.enum(DRAFT_KINDS),
});

export async function resetDraftOverride(input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = resetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid input' };
  const { event_id, kind } = parsed.data;
  const db = getDb();
  const row = db.select().from(events).where(eq(events.id, event_id)).get();
  if (!row) return { ok: false, error: 'Event not found.' };
  const current = row.draft_overrides ?? {};
  if (!(kind in current)) {
    return { ok: true }; // nothing to clear
  }
  const next: Partial<Record<DraftKind, string>> = { ...current };
  delete next[kind];
  const value = Object.keys(next).length === 0 ? null : next;
  db.update(events).set({ draft_overrides: value }).where(eq(events.id, event_id)).run();
  revalidatePath(`/events/${event_id}`);
  return { ok: true };
}

export async function regenerateEventSummary(id: number): Promise<{ ok: true; summary: string } | { ok: false; error: string }> {
  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: 'Invalid event id.' };
  const db = getDb();
  const row = db.select().from(events).where(eq(events.id, id)).get();
  if (!row) return { ok: false, error: 'Event not found.' };
  if (!row.edm_body) return { ok: false, error: 'No EDM body — nothing to summarise. Paste the email body first.' };
  const fallbackYear = new Date(row.event_date).getFullYear();
  const summary = summarizeEdm(row.edm_body, row.edm_subject ?? '', fallbackYear);
  if (!summary) return { ok: false, error: 'Heuristics did not match any structured facts in the body.' };
  db.update(events).set({ edm_summary: summary }).where(eq(events.id, id)).run();
  revalidatePath(`/events/${id}`);
  return { ok: true, summary };
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
  if (confirm_phrase !== DELETE_CONFIRM_PHRASE) {
    return { ok: false, error: `Type ${DELETE_CONFIRM_PHRASE} to confirm deletion.` };
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
