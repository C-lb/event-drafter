import type { Job } from '@event-drafter/core';
import { getDb } from '@event-drafter/core/db';
import { contacts, invites, replies } from '@event-drafter/core/schema';
import { REACTION_EMOJIS, type ReactionEmoji } from '@event-drafter/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { reactToLastInbound } from '../wa/driver.js';
import { WaInvalidNumber, WaNotLoggedIn, WaSelectorMismatch } from '../wa/session.js';
import { JobDeferred } from '../errors.js';
import { logger } from '../logger.js';

const payloadSchema = z.object({
  reply_id: z.number(),
  emoji: z.enum(REACTION_EMOJIS as unknown as [string, ...string[]]),
});

/**
 * Sends a WhatsApp reaction (👍/❤️) on the contact's most recent inbound
 * message, as a lightweight acknowledgement of a clear yes/no. The reaction is
 * committed by the emoji click alone (no text sent). See driver.reactToLastInbound.
 */
export async function sendReactionHandler(job: Job): Promise<void> {
  const { reply_id, emoji } = payloadSchema.parse(job.payload);

  const db = getDb();
  const reply = db.select().from(replies).where(eq(replies.id, reply_id)).get();
  if (!reply) throw new Error(`reply ${reply_id} not found`);
  if (reply.reaction_status === 'sent') {
    logger.warn('send_reaction: already sent — skip', { reply_id });
    return;
  }

  const invite = db.select().from(invites).where(eq(invites.id, reply.invite_id)).get();
  if (!invite) throw new Error(`invite ${reply.invite_id} not found`);
  const contact = db.select().from(contacts).where(eq(contacts.id, invite.contact_id)).get();
  if (!contact) throw new Error(`contact ${invite.contact_id} not found`);

  db.update(replies)
    .set({ reaction_status: 'sending', reaction_emoji: emoji as ReactionEmoji })
    .where(eq(replies.id, reply_id))
    .run();

  try {
    await reactToLastInbound(contact.phone_e164, emoji);
  } catch (err) {
    // Not logged in is transient — defer and keep the 'sending' state.
    if (err instanceof WaNotLoggedIn) throw new JobDeferred(10 * 60 * 1000, 'WA not logged in');
    // Everything else (invalid number, or a selector that needs live tuning)
    // fails visibly so the operator can retry rather than see it hang.
    db.update(replies).set({ reaction_status: 'failed' }).where(eq(replies.id, reply_id)).run();
    if (err instanceof WaInvalidNumber) throw err;
    if (err instanceof WaSelectorMismatch) {
      logger.warn('send_reaction: could not react (selector needs tuning)', {
        reply_id,
        err: err.message,
      });
    }
    throw err;
  }

  db.update(replies)
    .set({ reaction_status: 'sent', reaction_sent_at: new Date() })
    .where(eq(replies.id, reply_id))
    .run();
  logger.info('send_reaction: reacted', { reply_id, emoji });
}
