import type { Job } from '@event-drafter/core';
import { getDb } from '@event-drafter/core/db';
import { invites, replies, jobs, contacts } from '@event-drafter/core/schema';
import { and, eq, gt, isNotNull, sql } from 'drizzle-orm';
import { ensureWaLoggedIn, readChatInbound, readChatReactions } from '../wa/driver.js';
import { joinThreadText } from '../wa/reader.js';
import { chooseReactionRsvp, reactionRsvpDecision } from '../wa/reactions.js';
import { WaInvalidNumber, WaNotLoggedIn, WaSelectorMismatch } from '../wa/session.js';
import { JobDeferred } from '../errors.js';
import { logger } from '../logger.js';

const LOOKBACK_DAYS = 14;
const READ_GAP_MS = 2000;

function setProgress(jobId: number, text: string | null): void {
  getDb().update(jobs).set({ progress: text }).where(eq(jobs.id, jobId)).run();
}

/** Truncates a Date to local-midnight start-of-day. */
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export async function checkRepliesHandler(job: Job): Promise<void> {
  const db = getDb();
  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 3600 * 1000);

  const rows = db
    .select({
      invite_id: invites.id,
      event_id: invites.event_id,
      phone: contacts.phone_e164,
      contact_name: contacts.first_name,
      sent_at: invites.sent_at,
    })
    .from(invites)
    .innerJoin(contacts, eq(invites.contact_id, contacts.id))
    .where(and(eq(invites.status, 'sent'), gt(invites.sent_at, cutoff), isNotNull(invites.sent_at)))
    .all();

  // No per-event map: each invite gets its OWN anchor = start of the day its
  // sent_at fell on. Chat history older than that day is dropped, so the reply
  // text shown to the operator covers just this contact's invite window.

  logger.info('check_replies: starting', { invite_count: rows.length });

  // Single login check + WA.base navigation for the whole batch. Each loop
  // iteration then jumps straight to the next chat URL, saving 1–2s/contact.
  // If WA logs out mid-batch, the per-chat waitForSelector will throw and we
  // defer the rest of the job.
  setProgress(job.id, `preparing — ${rows.length} contacts`);
  try {
    await ensureWaLoggedIn();
  } catch (err) {
    if (err instanceof WaNotLoggedIn) {
      setProgress(job.id, null);
      throw new JobDeferred(10 * 60 * 1000, 'WA not logged in — defer 10 min');
    }
    throw err;
  }

  let totalNew = 0;
  let totalUpdated = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    setProgress(job.id, `checking ${i + 1}/${rows.length} — ${row.contact_name}`);
    try {
      // skipPrelude: login + base goto already done above for the whole batch.
      const fullThread = await readChatInbound(row.phone, row.contact_name, { skipPrelude: true });
      const inviteSentAt = row.sent_at as Date | null;
      const anchor = inviteSentAt ? startOfDay(inviteSentAt) : null;

      // Drop anything older than the day THIS contact's invite was sent.
      // The reader's walk-back-to-our-last-outbound usually already bounds
      // this, but the date floor is the operator-facing guarantee.
      const thread = anchor
        ? fullThread.filter((m) => m.wa_sent_at.getTime() >= anchor.getTime())
        : fullThread;

      // --- Text reply handling (only when there is a new inbound thread) ---
      if (thread.length === 0) {
        if (fullThread.length > 0 && anchor) {
          logger.info('check_replies: thread fully pre-invite — skipping', {
            invite_id: row.invite_id,
            event_id: row.event_id,
            anchor: anchor.toISOString(),
            visible: fullThread.length,
          });
        }
      } else {
        // The reader already walked back to our last outbound message, so
        // every message in `thread` is part of the contact's reply since we
        // last spoke. Roll it into a single reply row.
        const joinedText = joinThreadText(thread);
        const latest = thread[thread.length - 1]!;

        const result = db.transaction((tx) => {
          const existing = tx
            .select()
            .from(replies)
            .where(eq(replies.invite_id, row.invite_id))
            .get();

          if (existing) {
            // No change since last scan? Skip.
            if (existing.wa_message_text === joinedText && existing.wa_message_id === (latest.wa_message_id ?? null)) {
              return { action: 'noop' as const, reply_id: existing.id };
            }
            // Thread grew or changed. Update the row and clear any prior
            // classification + draft so the LLM re-reads the latest context.
            //
            // Even if we'd already sent a response in this thread, drop status
            // back to 'pending' so the operator sees a fresh draft for the new
            // message. response_sent_at is preserved as audit history so we
            // still know we previously replied. response_{approved,prefilled}_at
            // get cleared because they belong to the prior turn.
            tx.update(replies)
              .set({
                wa_message_id: latest.wa_message_id ?? null,
                wa_message_text: joinedText,
                wa_sent_at: latest.wa_sent_at,
                detected_at: new Date(),
                classification: null,
                classification_confidence: null,
                classification_summary: null,
                response_draft: null,
                response_status: 'pending',
                response_approved_at: null,
                response_prefilled_at: null,
              })
              .where(eq(replies.id, existing.id))
              .run();
            tx.insert(jobs).values({
              kind: 'classify_reply',
              payload: { reply_id: existing.id },
            }).run();
            return { action: 'updated' as const, reply_id: existing.id };
          }

          const inserted = tx.insert(replies).values({
            invite_id: row.invite_id,
            wa_message_id: latest.wa_message_id ?? null,
            wa_message_text: joinedText,
            wa_sent_at: latest.wa_sent_at,
            response_status: 'pending',
          }).returning().get();
          tx.insert(jobs).values({
            kind: 'classify_reply',
            payload: { reply_id: inserted.id },
          }).run();
          return { action: 'inserted' as const, reply_id: inserted.id };
        });

        if (result.action === 'inserted') {
          totalNew++;
          logger.info('check_replies: new reply', { invite_id: row.invite_id, reply_id: result.reply_id, threadLen: thread.length });
        } else if (result.action === 'updated') {
          totalUpdated++;
          logger.info('check_replies: thread updated', { invite_id: row.invite_id, reply_id: result.reply_id, threadLen: thread.length });
        }
      }

      // --- Reaction handling (always; the chat is still open) ---
      // The recipient may have reacted to our invite instead of (or as well as)
      // texting. A real text reply always wins (reactionRsvpDecision), so this
      // never overwrites an llm/manual reply. No draft is enqueued.
      const reaction = chooseReactionRsvp(await readChatReactions());
      if (reaction) {
        const rx = db.transaction((tx) => {
          const existing = tx
            .select()
            .from(replies)
            .where(eq(replies.invite_id, row.invite_id))
            .get();
          if (reactionRsvpDecision(existing?.classification_source ?? null) === 'skip') {
            return { action: 'rx-skip' as const, reply_id: existing?.id ?? 0 };
          }
          const summary = `Reacted ${reaction.emoji}`;
          let replyId: number;
          if (existing) {
            tx.update(replies)
              .set({
                classification: reaction.classification,
                classification_confidence: 1,
                classification_summary: summary,
                classification_source: 'reaction',
                detected_at: new Date(),
              })
              .where(eq(replies.id, existing.id))
              .run();
            replyId = existing.id;
          } else {
            const inserted = tx.insert(replies).values({
              invite_id: row.invite_id,
              wa_message_id: null,
              wa_message_text: summary,
              wa_sent_at: new Date(),
              classification: reaction.classification,
              classification_confidence: 1,
              classification_summary: summary,
              classification_source: 'reaction',
              response_status: 'pending',
            }).returning().get();
            replyId = inserted.id;
          }
          tx.update(invites)
            .set({ rsvp: reaction.classification })
            .where(eq(invites.id, row.invite_id))
            .run();
          return { action: existing ? ('rx-updated' as const) : ('rx-inserted' as const), reply_id: replyId };
        });

        if (rx.action === 'rx-inserted') {
          totalNew++;
          logger.info('check_replies: reaction RSVP', {
            invite_id: row.invite_id, reply_id: rx.reply_id, rsvp: reaction.classification, emoji: reaction.emoji,
          });
        } else if (rx.action === 'rx-updated') {
          totalUpdated++;
          logger.info('check_replies: reaction RSVP (updated)', {
            invite_id: row.invite_id, reply_id: rx.reply_id, rsvp: reaction.classification,
          });
        }
      }
    } catch (err) {
      if (err instanceof WaNotLoggedIn) {
        setProgress(job.id, null);
        throw new JobDeferred(10 * 60 * 1000, 'WA not logged in — defer 10 min');
      }
      if (err instanceof WaSelectorMismatch) {
        setProgress(job.id, null);
        throw new JobDeferred(60 * 60 * 1000, `selector mismatch — defer 1h: ${err.message}`);
      }
      if (err instanceof WaInvalidNumber) {
        logger.warn('check_replies: invalid number', { invite_id: row.invite_id });
        continue;
      }
      logger.error('check_replies: chat error', {
        invite_id: row.invite_id,
        err: err instanceof Error ? err.message : String(err),
      });
    }
    await sleep(READ_GAP_MS);
  }

  setProgress(job.id, null);
  logger.info('check_replies: done', { totalNew, totalUpdated });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Suppress unused-import warning for `sql` if Drizzle's TS plugin doesn't
// auto-detect tree-shake usage. Keeping the import in case future query
// composition reuses it.
void sql;
