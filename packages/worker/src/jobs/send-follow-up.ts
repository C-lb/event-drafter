import type { Job } from '@event-drafter/core';
import { getDb } from '@event-drafter/core/db';
import { contacts, follow_ups, invites } from '@event-drafter/core/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { prefillDraft } from '../wa/driver.js';
import { WaInvalidNumber, WaNotLoggedIn, WaSelectorMismatch } from '../wa/session.js';
import { sendDelayMs, jitterMs } from '../rate-limit.js';
import { JobDeferred } from '../errors.js';
import { logger } from '../logger.js';

const payloadSchema = z.object({ follow_up_id: z.number() });

export async function sendFollowUpHandler(job: Job): Promise<void> {
  const { follow_up_id } = payloadSchema.parse(job.payload);

  const delay = sendDelayMs();
  if (delay !== null) throw new JobDeferred(delay, `rate limit — defer ${delay}ms`);

  const db = getDb();
  const fu = db.select().from(follow_ups).where(eq(follow_ups.id, follow_up_id)).get();
  if (!fu) throw new Error(`follow_up ${follow_up_id} not found`);
  if (fu.status !== 'approved') {
    logger.warn('send_follow_up: not approved — skip', { follow_up_id, status: fu.status });
    return;
  }
  const invite = db.select().from(invites).where(eq(invites.id, fu.invite_id)).get();
  if (!invite) throw new Error(`invite ${fu.invite_id} not found`);
  const contact = db.select().from(contacts).where(eq(contacts.id, invite.contact_id)).get();
  if (!contact) throw new Error(`contact ${invite.contact_id} not found`);

  try {
    await prefillDraft(contact.phone_e164, fu.draft_text);
  } catch (err) {
    if (err instanceof WaNotLoggedIn) throw new JobDeferred(10 * 60 * 1000, 'WA not logged in');
    if (err instanceof WaSelectorMismatch) throw new JobDeferred(60 * 60 * 1000, err.message);
    if (err instanceof WaInvalidNumber) {
      db.update(follow_ups).set({ status: 'failed' }).where(eq(follow_ups.id, follow_up_id)).run();
      throw err;
    }
    throw err;
  }

  db.update(follow_ups)
    .set({ status: 'prefilled', prefilled_at: new Date() })
    .where(eq(follow_ups.id, follow_up_id))
    .run();

  const gap = jitterMs();
  logger.info('send_follow_up: prefilled, sleeping jitter', { follow_up_id, gap });
  await new Promise((r) => setTimeout(r, gap));
}
