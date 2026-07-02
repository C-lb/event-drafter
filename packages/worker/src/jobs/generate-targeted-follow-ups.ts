import type { Job } from '@event-drafter/core';
import { getDb } from '@event-drafter/core/db';
import { contacts, events, follow_ups, invites } from '@event-drafter/core/schema';
import { eq } from 'drizzle-orm';
import { getSetting } from '@event-drafter/core/settings';
import { complete } from '../llm/client.js';
import { buildTargetedFollowUpPrompt } from '../llm/prompts.js';
import { sanitizeDraft } from '../llm/sanitize.js';
import { logger } from '../logger.js';

const DEFAULT_STYLE_GUIDE = 'Brief and warm. 1-3 sentences. No emoji. No pressure.';

interface TargetedPayload {
  event_id?: number;
  invite_ids?: number[];
  mode?: 'general' | 'tailored';
}

export async function generateTargetedFollowUpsHandler(job: Job): Promise<void> {
  const db = getDb();
  const payload = (job.payload ?? {}) as TargetedPayload;
  const eventId = payload.event_id;
  const inviteIds = Array.isArray(payload.invite_ids) ? payload.invite_ids : [];
  const mode: 'general' | 'tailored' = payload.mode === 'tailored' ? 'tailored' : 'general';

  if (!eventId || inviteIds.length === 0) {
    logger.warn('generate_targeted_follow_ups: nothing to do', { eventId, count: inviteIds.length });
    return;
  }

  const event = db.select().from(events).where(eq(events.id, eventId)).get();
  if (!event) {
    logger.warn('generate_targeted_follow_ups: event not found', { eventId });
    return;
  }

  const style_guide = getSetting('style_guide') ?? DEFAULT_STYLE_GUIDE;
  let drafted = 0;

  for (const inviteId of inviteIds) {
    const inv = db.select().from(invites).where(eq(invites.id, inviteId)).get();
    if (!inv || inv.event_id !== eventId) continue;
    const contact = db.select().from(contacts).where(eq(contacts.id, inv.contact_id)).get();
    if (!contact) continue;

    const prompt = buildTargetedFollowUpPrompt({
      event,
      contact,
      mode,
      style_guide,
      logistics: {
        food_pref: inv.food_pref,
        chauffeured: inv.chauffeured,
        parking_coupon: inv.parking_coupon,
        takes_bus: inv.takes_bus,
      },
    });

    try {
      const result = await complete(prompt, 400);
      db.insert(follow_ups)
        .values({ invite_id: inviteId, draft_text: sanitizeDraft(result.text), status: 'drafted' })
        .run();
      drafted++;
    } catch (err) {
      logger.error('generate_targeted_follow_ups: draft failed', {
        invite_id: inviteId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info('generate_targeted_follow_ups: done', { drafted, requested: inviteIds.length });
}
