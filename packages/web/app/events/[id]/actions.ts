'use server';

import { z } from 'zod';
import { getDb } from '@event-drafter/core/db';
import { contacts, events, follow_ups, invites, jobs, replies } from '@event-drafter/core/schema';
import { getSetting, setSetting } from '@event-drafter/core/settings';
import { and, eq, inArray, isNull, like, notInArray, or, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

export async function getEventOrThrow(id: number) {
  const db = getDb();
  const e = db.select().from(events).where(eq(events.id, id)).get();
  if (!e) throw new Error(`event ${id} not found`);
  return e;
}

export interface RsvpInvitee {
  invite_id: number;
  contact_name: string;
  reply_text: string | null;
  summary: string | null;
  confidence: number | null;
  days_since_sent: number;
  days_since_reply: number | null;
  follow_up_status: string | null;
  follow_up_eligible: boolean;
  expected_response: 'likely-yes' | 'unsure' | 'unlikely';
}

export interface RsvpSummary {
  yes: { invite_id: number; contact_name: string }[];
  no: { invite_id: number; contact_name: string }[];
  maybe: RsvpInvitee[];
  unclear: RsvpInvitee[];
  no_reply_yet: RsvpInvitee[];
}

const MIN_DAYS_BEFORE_FOLLOW_UP = 3;
const MS_PER_DAY = 24 * 3600 * 1000;
const ACTIVE_FOLLOW_UP_STATUSES = ['drafted', 'approved', 'prefilled', 'sent'] as const;

/**
 * Per-event RSVP summary. Buckets every sent invite into:
 *   yes / no                — name-only lists (operator just wants the count + roster).
 *   maybe / unclear         — full row: reply text, LLM summary, follow-up
 *                             status, and a heuristic "expected_response" so
 *                             the operator can scan quickly.
 *   no_reply_yet            — contact hasn't replied. Includes follow-up
 *                             eligibility per the rules in
 *                             generate-follow-ups.ts.
 *
 * "expected_response" is a deterministic projection of the classification —
 * we do NOT call the LLM here. The classification_summary already carries
 * the gist of why we landed on maybe/unclear.
 */
export async function getEventRsvpSummary(event_id: number): Promise<RsvpSummary> {
  const db = getDb();
  const now = Date.now();

  const rows = db
    .select({
      invite_id: invites.id,
      first_name: contacts.first_name,
      last_name: contacts.last_name,
      sent_at: invites.sent_at,
      classification: replies.classification,
      classification_summary: replies.classification_summary,
      classification_confidence: replies.classification_confidence,
      reply_text: replies.wa_message_text,
      reply_detected_at: replies.detected_at,
      follow_up_status: follow_ups.status,
    })
    .from(invites)
    .innerJoin(contacts, eq(invites.contact_id, contacts.id))
    .leftJoin(replies, eq(replies.invite_id, invites.id))
    .leftJoin(follow_ups, eq(follow_ups.invite_id, invites.id))
    .where(and(eq(invites.event_id, event_id), eq(invites.status, 'sent')))
    .orderBy(sql`${contacts.sheet_row_index} IS NULL, ${contacts.sheet_row_index} ASC, ${contacts.id} ASC`)
    .all();

  const summary: RsvpSummary = { yes: [], no: [], maybe: [], unclear: [], no_reply_yet: [] };

  for (const r of rows) {
    const contact_name = `${r.first_name}${r.last_name ? ' ' + r.last_name : ''}`;
    const sentMs = r.sent_at instanceof Date ? r.sent_at.getTime() : r.sent_at ? Number(r.sent_at) : null;
    const days_since_sent = sentMs ? Math.floor((now - sentMs) / MS_PER_DAY) : 0;
    const detectedMs = r.reply_detected_at instanceof Date ? r.reply_detected_at.getTime() : r.reply_detected_at ? Number(r.reply_detected_at) : null;
    const days_since_reply = detectedMs ? Math.floor((now - detectedMs) / MS_PER_DAY) : null;
    const has_active_follow_up = r.follow_up_status !== null && (ACTIVE_FOLLOW_UP_STATUSES as readonly string[]).includes(r.follow_up_status);
    const follow_up_eligible =
      !r.classification && // no reply yet
      days_since_sent >= MIN_DAYS_BEFORE_FOLLOW_UP &&
      !has_active_follow_up;

    if (r.classification === 'yes') {
      summary.yes.push({ invite_id: r.invite_id, contact_name });
      continue;
    }
    if (r.classification === 'no') {
      summary.no.push({ invite_id: r.invite_id, contact_name });
      continue;
    }

    // Heuristic — Maybe usually carries a "let me check" intent.
    // Unclear is "they acknowledged but didn't commit"; unlikely to come back
    // without nudging.
    let expected_response: RsvpInvitee['expected_response'];
    if (r.classification === 'maybe') expected_response = 'likely-yes';
    else if (r.classification === 'unclear') expected_response = 'unsure';
    else expected_response = 'unsure';

    const invitee: RsvpInvitee = {
      invite_id: r.invite_id,
      contact_name,
      reply_text: r.reply_text ?? null,
      summary: r.classification_summary ?? null,
      confidence: r.classification_confidence ?? null,
      days_since_sent,
      days_since_reply,
      follow_up_status: r.follow_up_status ?? null,
      follow_up_eligible,
      expected_response,
    };

    if (r.classification === 'maybe') summary.maybe.push(invitee);
    else if (r.classification === 'unclear') summary.unclear.push(invitee);
    else summary.no_reply_yet.push(invitee);
  }

  return summary;
}

export async function listInvitesForEvent(event_id: number) {
  const db = getDb();
  return db
    .select({
      invite_id: invites.id,
      status: invites.status,
      draft_text: invites.draft_text,
      sent_at: invites.sent_at,
      sent_confirmed_at: invites.sent_confirmed_at,
      contact_id: contacts.id,
      first_name: contacts.first_name,
      last_name: contacts.last_name,
      phone_e164: contacts.phone_e164,
      remarks: contacts.remarks,
    })
    .from(invites)
    .innerJoin(contacts, eq(invites.contact_id, contacts.id))
    .where(eq(invites.event_id, event_id))
    .orderBy(sql`${contacts.sheet_row_index} IS NULL, ${contacts.sheet_row_index} ASC, ${contacts.id} ASC`)
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

/**
 * Add contacts to an event as pending invites with NO message drafted. Drafting
 * is opt-in: the operator reviews the contact list first, then clicks Auto-draft
 * (or applies a template) to generate messages. This is why we no longer enqueue
 * draft_invite jobs here.
 */
export async function addContactsToEvent(input: unknown) {
  const { event_id, contact_ids } = generateSchema.parse(input);
  const db = getDb();
  db.transaction((tx) => {
    for (const cid of contact_ids) {
      tx.insert(invites)
        .values({ event_id, contact_id: cid, status: 'pending' })
        .onConflictDoNothing()
        .run();
    }
  });
  revalidatePath(`/events/${event_id}/queue`);
  return { added: contact_ids.length };
}

const autoDraftSchema = z.object({ event_id: z.number().int().positive() });

/**
 * Enqueue a draft_invite job for every pending, undrafted invite on this event
 * that doesn't already have an active (queued/running) draft job. Idempotent:
 * clicking twice won't double-enqueue. Flips the event into 'drafting' so the
 * dashboard reflects that the LLM is working.
 */
export async function autoDraftEvent(input: unknown): Promise<{ ok: true; drafting: number } | { ok: false; error: string }> {
  const parsed = autoDraftSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid input' };
  const { event_id } = parsed.data;
  const db = getDb();

  // Contact pairs that already have an in-flight draft job, so we don't queue a
  // second one for the same invite.
  const activeDraftPairs = new Set(
    db
      .select({ payload: jobs.payload })
      .from(jobs)
      .where(and(eq(jobs.kind, 'draft_invite'), inArray(jobs.status, ['queued', 'running'])))
      .all()
      .map((j) => {
        const p = j.payload as { event_id?: number; contact_id?: number } | null;
        return `${p?.event_id}:${p?.contact_id}`;
      }),
  );

  const undrafted = db
    .select({ contact_id: invites.contact_id })
    .from(invites)
    .where(and(eq(invites.event_id, event_id), eq(invites.status, 'pending'), isNull(invites.draft_text)))
    .all();

  let drafting = 0;
  db.transaction((tx) => {
    for (const inv of undrafted) {
      if (activeDraftPairs.has(`${event_id}:${inv.contact_id}`)) continue;
      tx.insert(jobs)
        .values({ kind: 'draft_invite', payload: { event_id, contact_id: inv.contact_id } })
        .run();
      drafting++;
    }
    if (drafting > 0) {
      tx.update(events).set({ status: 'drafting' }).where(eq(events.id, event_id)).run();
    }
  });

  revalidatePath(`/events/${event_id}/queue`);
  return { ok: true, drafting };
}

const editSchema = z.object({ invite_id: z.number(), draft_text: z.string().min(1).max(2000) });
export async function editDraft(input: unknown) {
  const { invite_id, draft_text } = editSchema.parse(input);
  const db = getDb();
  db.update(invites).set({ draft_text }).where(eq(invites.id, invite_id)).run();
}

const approveSchema = z.object({ invite_id: z.number() });
// Persist (or clear) the per-event delegate tracker sheet link. Accepts a full
// Google Sheets URL or a bare spreadsheet ID; empty string clears it. We only
// sanity-check that an ID is extractable — the worker re-parses at write time.
const SHEET_ID_RE = /\/d\/[a-zA-Z0-9-_]+|^[a-zA-Z0-9-_]{20,}$/;
const delegateSheetSchema = z.object({
  event_id: z.number().int().positive(),
  url: z.string().trim().max(500),
});
export async function setDelegateSheet(
  input: unknown,
): Promise<{ ok: true; url: string | null } | { ok: false; error: string }> {
  const parsed = delegateSheetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid input' };
  const { event_id, url } = parsed.data;
  const trimmed = url.trim();
  if (trimmed && !SHEET_ID_RE.test(trimmed)) {
    return { ok: false, error: 'That does not look like a Google Sheets link or ID.' };
  }
  const db = getDb();
  db.update(events)
    .set({ delegate_sheet_url: trimmed || null })
    .where(eq(events.id, event_id))
    .run();
  revalidatePath(`/events/${event_id}`);
  return { ok: true, url: trimmed || null };
}

export async function approveDraft(input: unknown) {
  const { invite_id } = approveSchema.parse(input);
  const db = getDb();
  db.transaction((tx) => {
    // Only enqueue if we actually transition into 'approved'. Excluding the
    // in-flight/done states makes this idempotent: a double-click, or a click
    // on a row the worker is already sending ('sending'), is a no-op instead of
    // a second send_message job. This is the UI-side half of the single-send
    // guarantee — the worker's send-claim is the other half.
    const res = tx
      .update(invites)
      .set({ status: 'approved', approved_at: new Date() })
      .where(
        and(
          eq(invites.id, invite_id),
          notInArray(invites.status, ['sending', 'approved', 'prefilled', 'sent']),
        ),
      )
      .run();
    if (res.changes === 1) {
      tx.insert(jobs).values({
        kind: 'send_message',
        payload: { invite_id },
      }).run();
    }
  });
}

const batchSchema = z.object({
  event_id: z.number().int().positive(),
  // Per CONTEXT.md cadence — batches of 5-8 messages, slow-drip via the
  // rate limiter. Cap at 5 from the UI so a careless double-click can't blow
  // through the human-mimicry envelope.
  limit: z.number().int().min(1).max(5).default(5),
});

export async function approveBatch(input: unknown): Promise<{ approved: number }> {
  const { event_id, limit } = batchSchema.parse(input);
  const db = getDb();
  const candidates = db
    .select({ id: invites.id })
    .from(invites)
    .where(and(eq(invites.event_id, event_id), eq(invites.status, 'drafted')))
    .orderBy(invites.created_at)
    .limit(limit)
    .all();

  if (candidates.length === 0) return { approved: 0 };

  const total = candidates.length;
  db.transaction((tx) => {
    candidates.forEach((c, i) => {
      tx.update(invites)
        .set({ status: 'approved', approved_at: new Date() })
        .where(eq(invites.id, c.id))
        .run();
      // batch_index/batch_size drive the "3 of 12" counter on send toasts.
      tx.insert(jobs).values({
        kind: 'send_message',
        payload: { invite_id: c.id, batch_index: i + 1, batch_size: total },
      }).run();
    });
  });
  return { approved: candidates.length };
}

// Approve EVERY drafted invite for the event. Unlike approveBatch this has no
// 5-row cap: approving only flips status + enqueues send jobs — the worker's
// rate limiter still paces the actual WhatsApp sends per CONTEXT.md, so a large
// approval can't burst messages. Bounded at 1000 purely as a runaway guard.
const approveAllSchema = z.object({ event_id: z.number().int().positive() });
export async function approveAll(input: unknown): Promise<{ approved: number }> {
  const { event_id } = approveAllSchema.parse(input);
  const db = getDb();
  const candidates = db
    .select({ id: invites.id })
    .from(invites)
    .where(and(eq(invites.event_id, event_id), eq(invites.status, 'drafted')))
    .orderBy(invites.created_at)
    .limit(1000)
    .all();

  if (candidates.length === 0) return { approved: 0 };

  const total = candidates.length;
  db.transaction((tx) => {
    candidates.forEach((c, i) => {
      tx.update(invites)
        .set({ status: 'approved', approved_at: new Date() })
        .where(eq(invites.id, c.id))
        .run();
      // batch_index/batch_size drive the "3 of 12" counter on send toasts.
      tx.insert(jobs).values({
        kind: 'send_message',
        payload: { invite_id: c.id, batch_index: i + 1, batch_size: total },
      }).run();
    });
  });
  return { approved: candidates.length };
}

// Sara's own template: substitute variables per invite and write the draft
// directly, bypassing the LLM. Tokens are case-insensitive: [first name],
// [last name], [event name], [date], [venue]. Applies to invites that are not
// yet approved/sent (pending + drafted), overwriting any existing draft.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtTemplateDate(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
function fillTemplate(
  template: string,
  vars: { first_name: string; last_name: string | null; event_name: string; date: string; venue: string | null },
): string {
  const map: Record<string, string> = {
    'first name': vars.first_name,
    'last name': vars.last_name ?? '',
    'event name': vars.event_name,
    date: vars.date,
    venue: vars.venue ?? '',
  };
  const filled = template.replace(/\[([^\]]+)\]/g, (whole: string, name: string) => {
    const val = map[name.trim().toLowerCase()];
    return val !== undefined ? val : whole; // leave unknown tokens untouched
  });
  // Collapse the double spaces / stray spaces a blank [last name] or [venue] leaves.
  return filled.replace(/[ \t]{2,}/g, ' ').replace(/ +([,.!?])/g, '$1').trim();
}

const TEMPLATE_TARGET_STATUSES = ['pending', 'drafted'] as const;
const applyTemplateSchema = z.object({
  event_id: z.number().int().positive(),
  template: z.string().min(1).max(2000),
});
export async function applyTemplate(input: unknown): Promise<{ applied: number }> {
  const { event_id, template } = applyTemplateSchema.parse(input);
  const db = getDb();
  const event = db.select().from(events).where(eq(events.id, event_id)).get();
  if (!event) throw new Error(`event ${event_id} not found`);

  const date = fmtTemplateDate(event.event_date as Date);
  const rows = db
    .select({
      invite_id: invites.id,
      first_name: contacts.first_name,
      last_name: contacts.last_name,
    })
    .from(invites)
    .innerJoin(contacts, eq(invites.contact_id, contacts.id))
    .where(and(eq(invites.event_id, event_id), inArray(invites.status, [...TEMPLATE_TARGET_STATUSES])))
    .all();

  if (rows.length === 0) return { applied: 0 };

  db.transaction((tx) => {
    for (const r of rows) {
      const draft_text = fillTemplate(template, {
        first_name: r.first_name,
        last_name: r.last_name,
        event_name: event.name,
        date,
        venue: event.venue,
      });
      tx.update(invites)
        .set({ draft_text, draft_generated_at: new Date(), status: 'drafted' })
        .where(eq(invites.id, r.invite_id))
        .run();
    }
  });
  revalidatePath(`/events/${event_id}/queue`);
  return { applied: rows.length };
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

export async function resendInvite(input: unknown) {
  const { invite_id } = markSentSchema.parse(input);
  const db = getDb();
  const inv = db.select().from(invites).where(eq(invites.id, invite_id)).get();
  if (!inv) throw new Error('invite not found');
  if (inv.status !== 'sent' && inv.status !== 'failed') {
    throw new Error(`can only resend a sent or failed invite (status: ${inv.status})`);
  }
  db.transaction((tx) => {
    tx.update(invites)
      .set({ status: 'approved', approved_at: new Date(), prefilled_at: null, sent_at: null })
      .where(eq(invites.id, invite_id))
      .run();
    tx.insert(jobs).values({ kind: 'send_message', payload: { invite_id } }).run();
  });
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

export async function getAutoSendEnabled(): Promise<boolean> {
  return getSetting('auto_send_enabled') === true;
}

export async function getRateLimitSnapshot() {
  // Late-imported so the worker package's better-sqlite3 native binding
  // isn't loaded until the action is actually called.
  const { getRateLimitState, RATE_LIMIT_CONFIG } = await import('@event-drafter/worker/rate-limit');
  const state = getRateLimitState();
  return {
    config: RATE_LIMIT_CONFIG,
    delayMs: state.delayMs,
    reason: state.reason,
    inBatch: state.inBatch,
    sentLastHour: state.sentLastHour,
    lastSendAtMs: state.lastSendAtMs,
    now: Date.now(),
  };
}

const autoSendSchema = z.object({ enabled: z.boolean() });
export async function setAutoSendEnabled(input: unknown): Promise<{ ok: true; enabled: boolean }> {
  const { enabled } = autoSendSchema.parse(input);
  setSetting('auto_send_enabled', enabled);
  revalidatePath('/events');
  return { ok: true, enabled };
}

export async function triggerReplyCheck() {
  const db = getDb();
  db.insert(jobs).values({ kind: 'check_replies', payload: {} }).run();
}

export async function listRepliesForEvent(event_id: number, includeResolved = false) {
  const db = getDb();
  const where = includeResolved
    ? eq(invites.event_id, event_id)
    : and(eq(invites.event_id, event_id), eq(replies.resolved, false));
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
      wa_sent_at: replies.wa_sent_at,
      resolved: replies.resolved,
      contact_name: sql<string>`${contacts.first_name} || ' ' || COALESCE(${contacts.last_name}, '')`,
      contact_id: contacts.id,
    })
    .from(replies)
    .innerJoin(invites, eq(replies.invite_id, invites.id))
    .innerJoin(contacts, eq(invites.contact_id, contacts.id))
    .where(where)
    .orderBy(sql`${replies.detected_at} DESC`)
    .all();
}

const resolveReplySchema = z.object({ reply_id: z.number().int().positive(), resolved: z.boolean() });
export async function setEventReplyResolved(input: unknown) {
  const { reply_id, resolved } = resolveReplySchema.parse(input);
  const db = getDb();
  db.update(replies)
    .set({ resolved, resolved_at: resolved ? new Date() : null })
    .where(eq(replies.id, reply_id))
    .run();
}

const responseActionSchema = z.object({ reply_id: z.number() });

export async function approveResponse(input: unknown) {
  const { reply_id } = responseActionSchema.parse(input);
  const db = getDb();
  const reply = db.select().from(replies).where(eq(replies.id, reply_id)).get();
  // A yes/no whose classification the worker reached on its own (no manual
  // override) is settled the moment its response is approved — record it in the
  // RSVP summary and drop it from the Replies feed. Maybe/unclear and any
  // operator-overridden reply stay visible for follow-up.
  const autoResolve =
    !!reply &&
    (reply.classification === 'yes' || reply.classification === 'no') &&
    reply.classification_source !== 'manual';

  // A confirmed "yes" updates the event's delegate tracker sheet (if one is
  // set): the worker shifts that delegate's row into the confirmed block.
  let trackerEventId: number | null = null;
  if (reply && reply.classification === 'yes') {
    const inv = db.select().from(invites).where(eq(invites.id, reply.invite_id)).get();
    if (inv) {
      const ev = db.select().from(events).where(eq(events.id, inv.event_id)).get();
      if (ev?.delegate_sheet_url) trackerEventId = ev.id;
    }
  }

  db.transaction((tx) => {
    tx.update(replies)
      .set({
        response_status: 'approved',
        response_approved_at: new Date(),
        ...(autoResolve ? { resolved: true, resolved_at: new Date() } : {}),
      })
      .where(eq(replies.id, reply_id))
      .run();
    tx.insert(jobs).values({ kind: 'send_response', payload: { reply_id } }).run();
    if (trackerEventId !== null) {
      tx.insert(jobs).values({ kind: 'update_delegate_tracker', payload: { event_id: trackerEventId } }).run();
    }
  });
  if (autoResolve) {
    revalidatePath('/replies');
    revalidatePath('/');
  }
}

export async function skipResponse(input: unknown) {
  const { reply_id } = responseActionSchema.parse(input);
  const db = getDb();
  db.update(replies).set({ response_status: 'skipped' }).where(eq(replies.id, reply_id)).run();
}

export async function markResponseSent(input: unknown) {
  const { reply_id } = responseActionSchema.parse(input);
  const db = getDb();
  // Same convention as auto-send: row drops back to 'pending' so the thread
  // is held open in the dashboard until the recipient sends again. Audit
  // trail lives in response_sent_at.
  db.update(replies)
    .set({ response_status: 'pending', response_sent_at: new Date() })
    .where(eq(replies.id, reply_id))
    .run();
}

const editResponseSchema = z.object({ reply_id: z.number(), response_draft: z.string().min(1).max(2000) });
export async function editResponse(input: unknown) {
  const { reply_id, response_draft } = editResponseSchema.parse(input);
  const db = getDb();
  db.update(replies).set({ response_draft }).where(eq(replies.id, reply_id)).run();
}

export async function regenerateResponse(input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const { reply_id } = responseActionSchema.parse(input);
  const db = getDb();
  const reply = db.select().from(replies).where(eq(replies.id, reply_id)).get();
  if (!reply) return { ok: false, error: 'reply not found' };
  // Refuse to regenerate once the operator has approved, prefilled, or sent
  // this response — the draft is already past the editing stage and a new
  // LLM pass would silently overwrite a message the operator just committed.
  if (reply.response_status === 'approved' || reply.response_status === 'prefilled' || reply.response_status === 'sent') {
    return { ok: false, error: `cannot regenerate when status is ${reply.response_status}` };
  }
  db.transaction((tx) => {
    // Clear the prior classification + draft so the textarea visibly empties
    // while the regen job is in flight. classify_reply will re-populate.
    tx.update(replies)
      .set({
        classification: null,
        classification_confidence: null,
        classification_summary: null,
        classification_source: 'llm',
        response_draft: null,
        response_status: 'pending',
      })
      .where(eq(replies.id, reply_id))
      .run();
    tx.insert(jobs).values({ kind: 'classify_reply', payload: { reply_id } }).run();
  });
  return { ok: true };
}
