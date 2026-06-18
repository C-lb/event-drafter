import type { Job } from '@event-drafter/core';
import { getDb } from '@event-drafter/core/db';
import { contacts, events, follow_ups, invites, replies } from '@event-drafter/core/schema';
import { and, eq, isNotNull, lte, notInArray } from 'drizzle-orm';
import { getSetting } from '@event-drafter/core/settings';
import { complete } from '../llm/client.js';
import { buildFollowUpPrompt } from '../llm/prompts.js';
import { sanitizeDraft } from '../llm/sanitize.js';
import { logger } from '../logger.js';

const MIN_DAYS_SINCE_SENT = 3;
const DEFAULT_STYLE_GUIDE = 'Brief and warm. 1-3 sentences. No emoji. No pressure.';

export async function generateFollowUpsHandler(_job: Job): Promise<void> {
  const db = getDb();
  const cutoff = new Date(Date.now() - MIN_DAYS_SINCE_SENT * 24 * 3600 * 1000);

  const repliedInviteIds = db.select({ id: replies.invite_id }).from(replies).all().map((r) => r.id);
  const followedInviteIds = db
    .select({ id: follow_ups.invite_id })
    .from(follow_ups)
    .where(notInArray(follow_ups.status, ['skipped', 'failed']))
    .all()
    .map((r) => r.id);

  const baseWhere = and(
    eq(invites.status, 'sent'),
    isNotNull(invites.sent_at),
    lte(invites.sent_at, cutoff),
  );

  const candidates = db
    .select({
      invite_id: invites.id,
      event_id: invites.event_id,
      contact_id: invites.contact_id,
      sent_at: invites.sent_at,
      draft_text: invites.draft_text,
    })
    .from(invites)
    .where(
      repliedInviteIds.length || followedInviteIds.length
        ? and(
            baseWhere,
            ...(repliedInviteIds.length ? [notInArray(invites.id, repliedInviteIds)] : []),
            ...(followedInviteIds.length ? [notInArray(invites.id, followedInviteIds)] : []),
          )
        : baseWhere,
    )
    .all();

  logger.info('generate_follow_ups: candidates', { count: candidates.length });

  if (candidates.length === 0) return;

  const style_guide = getSetting('style_guide') ?? DEFAULT_STYLE_GUIDE;
  let drafted = 0;
  for (const c of candidates) {
    const event = db.select().from(events).where(eq(events.id, c.event_id)).get();
    const contact = db.select().from(contacts).where(eq(contacts.id, c.contact_id)).get();
    if (!event || !contact) continue;
    const days_since_sent = Math.max(1, Math.floor((Date.now() - (c.sent_at as Date).getTime()) / 86_400_000));

    const prompt = buildFollowUpPrompt({
      event, contact,
      original_invite_text: c.draft_text ?? '(original not stored)',
      days_since_sent,
      style_guide,
    });

    try {
      const result = await complete(prompt, 400);
      db.insert(follow_ups).values({
        invite_id: c.invite_id,
        draft_text: sanitizeDraft(result.text),
        status: 'drafted',
      }).run();
      drafted++;
    } catch (err) {
      logger.error('generate_follow_ups: draft failed', {
        invite_id: c.invite_id,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info('generate_follow_ups: done', { drafted });
}
