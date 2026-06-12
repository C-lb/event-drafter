import type { Job } from '@vip/core';
import { getDb } from '@vip/core/db';
import { contacts, invites } from '@vip/core/schema';
import { getSetting } from '@vip/core/settings';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { prefillDraft, clickSendInPrefilledChat } from '../wa/driver.js';
import { WaInvalidNumber, WaNotLoggedIn, WaSelectorMismatch } from '../wa/session.js';
import { sendDelayMs, jitterMs } from '../rate-limit.js';
import { JobDeferred } from '../errors.js';
import { logger } from '../logger.js';

const payloadSchema = z.object({ invite_id: z.number() });

export async function sendMessageHandler(job: Job): Promise<void> {
  const { invite_id } = payloadSchema.parse(job.payload);

  const delay = sendDelayMs();
  if (delay !== null) {
    throw new JobDeferred(delay, `rate limit — defer ${delay}ms`);
  }

  const db = getDb();
  const inv = db.select().from(invites).where(eq(invites.id, invite_id)).get();
  if (!inv) throw new Error(`invite ${invite_id} not found`);
  if (inv.status !== 'approved') {
    logger.warn('send_message: invite not in approved status — skipping', { invite_id, status: inv.status });
    return;
  }
  if (!inv.draft_text) throw new Error(`invite ${invite_id} has no draft_text`);

  const contact = db.select().from(contacts).where(eq(contacts.id, inv.contact_id)).get();
  if (!contact) throw new Error(`contact ${inv.contact_id} not found`);

  try {
    await prefillDraft(contact.phone_e164, inv.draft_text);
  } catch (err) {
    if (err instanceof WaNotLoggedIn) {
      throw new JobDeferred(10 * 60 * 1000, 'WA not logged in — defer 10 min');
    }
    if (err instanceof WaInvalidNumber) {
      db.update(invites)
        .set({ status: 'failed' })
        .where(eq(invites.id, invite_id))
        .run();
      throw err;
    }
    if (err instanceof WaSelectorMismatch) {
      throw new JobDeferred(60 * 60 * 1000, `selector mismatch — defer 1h: ${err.message}`);
    }
    throw err;
  }

  db.update(invites)
    .set({ status: 'prefilled', prefilled_at: new Date() })
    .where(eq(invites.id, invite_id))
    .run();

  // Auto-send mode: keep going and click WA's send button. The rate limiter
  // (sendDelayMs / jitterMs / batches) already enforces the human-mimicry
  // cadence — auto_send_enabled only removes the "human clicks send" step.
  // See CONTEXT.md "Auto-send mode" for the trade-offs.
  const autoSend = getSetting('auto_send_enabled') === true;
  if (autoSend) {
    try {
      await clickSendInPrefilledChat();
    } catch (err) {
      if (err instanceof WaSelectorMismatch) {
        // Pre-fill worked, send button didn't. Leave the invite in `prefilled`
        // so the operator can click send manually and Mark Sent.
        logger.warn('send_message: auto-send selector mismatch — leaving as prefilled', {
          invite_id, err: err.message,
        });
        const gap = jitterMs();
        await new Promise((r) => setTimeout(r, gap));
        return;
      }
      throw err;
    }
    db.update(invites)
      .set({ status: 'sent', sent_at: new Date() })
      .where(eq(invites.id, invite_id))
      .run();
    logger.info('send_message: auto-sent', { invite_id });
  }

  const gap = jitterMs();
  logger.info('send_message: cycle complete, sleeping jitter', { invite_id, gap, autoSent: autoSend });
  await new Promise((r) => setTimeout(r, gap));
}
