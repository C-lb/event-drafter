import type { Job } from '@vip/core';
import { getDb } from '@vip/core/db';
import { contacts, invites, replies } from '@vip/core/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { prefillDraft } from '../wa/driver.js';
import { WaInvalidNumber, WaNotLoggedIn, WaSelectorMismatch } from '../wa/session.js';
import { sendDelayMs, jitterMs } from '../rate-limit.js';
import { JobDeferred } from '../errors.js';
import { logger } from '../logger.js';

const payloadSchema = z.object({ reply_id: z.number() });

export async function sendResponseHandler(job: Job): Promise<void> {
  const { reply_id } = payloadSchema.parse(job.payload);

  const delay = sendDelayMs();
  if (delay !== null) throw new JobDeferred(delay, `rate limit — defer ${delay}ms`);

  const db = getDb();
  const reply = db.select().from(replies).where(eq(replies.id, reply_id)).get();
  if (!reply) throw new Error(`reply ${reply_id} not found`);
  if (reply.response_status !== 'approved') {
    logger.warn('send_response: not approved — skip', { reply_id, status: reply.response_status });
    return;
  }
  if (!reply.response_draft) throw new Error(`reply ${reply_id} has no response_draft`);

  const invite = db.select().from(invites).where(eq(invites.id, reply.invite_id)).get();
  if (!invite) throw new Error(`invite ${reply.invite_id} not found`);
  const contact = db.select().from(contacts).where(eq(contacts.id, invite.contact_id)).get();
  if (!contact) throw new Error(`contact ${invite.contact_id} not found`);

  try {
    await prefillDraft(contact.phone_e164, reply.response_draft);
  } catch (err) {
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

  const gap = jitterMs();
  logger.info('send_response: prefilled, sleeping jitter', { reply_id, gap });
  await new Promise((r) => setTimeout(r, gap));
}
