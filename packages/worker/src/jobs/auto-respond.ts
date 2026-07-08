import type { Job } from '@event-drafter/core';
import { getDb } from '@event-drafter/core/db';
import { contacts, invites, replies } from '@event-drafter/core/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { draftResponseForReply } from './redraft-reply.js';
import { prefillDraft, clickSendInPrefilledChat } from '../wa/driver.js';
import { WaInvalidNumber, WaNotLoggedIn, WaSelectorMismatch, WaSendNotConfirmed } from '../wa/session.js';
import { sendDelayMs, jitterMs } from '../rate-limit.js';
import { JobDeferred } from '../errors.js';
import { claimResponseForSend, releaseResponseClaim } from './send-claim.js';
import { logger } from '../logger.js';

const payloadSchema = z.object({ reply_id: z.number() });

/**
 * Auto-draft AND send a reply's response in one shot, no operator review.
 * Backs the "Auto-draft and Send" button. Unlike send_response this ALWAYS
 * sends — it does NOT gate on the auto_send_enabled setting — because the
 * operator explicitly asked to send. The per-record send claim still guards
 * against a double send, and every WhatsApp failure fails safe (defer or mark
 * failed) rather than sending the wrong thing.
 */
export async function autoRespondHandler(job: Job): Promise<void> {
  const { reply_id } = payloadSchema.parse(job.payload);

  const delay = sendDelayMs();
  if (delay !== null) throw new JobDeferred(delay, `rate limit — defer ${delay}ms`);

  const db = getDb();
  const reply = db.select().from(replies).where(eq(replies.id, reply_id)).get();
  if (!reply) throw new Error(`reply ${reply_id} not found`);
  if (reply.response_status === 'sent') {
    logger.warn('auto_respond: already sent — skip', { reply_id });
    return;
  }

  // 1. Draft — honours the classification already on the row, never reclassifies.
  const response_draft = await draftResponseForReply(reply_id);

  // 2. Persist as 'approved' so the per-record claim below can CAS it to 'sending'.
  db.update(replies)
    .set({ response_draft, response_status: 'approved', response_approved_at: new Date() })
    .where(eq(replies.id, reply_id))
    .run();

  const invite = db.select().from(invites).where(eq(invites.id, reply.invite_id)).get();
  if (!invite) throw new Error(`invite ${reply.invite_id} not found`);
  const contact = db.select().from(contacts).where(eq(contacts.id, invite.contact_id)).get();
  if (!contact) throw new Error(`contact ${invite.contact_id} not found`);

  // 3. Single-send guarantee (atomic approved -> sending).
  if (!claimResponseForSend(reply_id)) {
    logger.warn('auto_respond: already claimed/sent — skip', { reply_id });
    return;
  }

  // 4. Prefill the chat with the draft.
  try {
    await prefillDraft(contact.phone_e164, response_draft);
  } catch (err) {
    releaseResponseClaim(reply_id);
    if (err instanceof WaNotLoggedIn) throw new JobDeferred(10 * 60 * 1000, 'WA not logged in');
    if (err instanceof WaSelectorMismatch) throw new JobDeferred(60 * 60 * 1000, err.message);
    if (err instanceof WaInvalidNumber) {
      db.update(replies).set({ response_status: 'failed' }).where(eq(replies.id, reply_id)).run();
      throw err;
    }
    throw err;
  }

  db.update(replies)
    .set({ response_status: 'prefilled', response_prefilled_at: new Date() })
    .where(eq(replies.id, reply_id))
    .run();

  // 5. Send it. Forced — sending is the entire point of this job.
  try {
    await clickSendInPrefilledChat(response_draft);
  } catch (err) {
    if (err instanceof WaSelectorMismatch || err instanceof WaSendNotConfirmed) {
      logger.warn('auto_respond: send not confirmed — left prefilled for manual send', {
        reply_id,
        err: err.message,
      });
      return;
    }
    throw err;
  }

  // Match send_response's post-send convention: fall back to 'pending' with
  // response_sent_at as the audit trail, so the thread reads as "open, waiting
  // on them" and re-text detection refreshes the draft if they reply again.
  db.update(replies)
    .set({ response_status: 'pending', response_sent_at: new Date() })
    .where(eq(replies.id, reply_id))
    .run();

  const gap = jitterMs();
  logger.info('auto_respond: drafted and sent', { reply_id, gap });
  await new Promise((r) => setTimeout(r, gap));
}
