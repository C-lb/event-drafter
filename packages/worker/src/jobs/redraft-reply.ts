import type { Job } from '@event-drafter/core';
import { getDb } from '@event-drafter/core/db';
import { contacts, events, invites, replies } from '@event-drafter/core/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { complete } from '../llm/client.js';
import { buildRedraftForClassificationPrompt, parseRedraft } from '../llm/prompts.js';
import { getSetting } from '@event-drafter/core/settings';
import { logger } from '../logger.js';

const payloadSchema = z.object({ reply_id: z.number() });

const DEFAULT_STYLE_GUIDE = 'Brief and warm. 1-3 sentences. No emoji.';

/**
 * Draft a response for a reply that honours the classification already on the
 * row (never re-classifies). Returns the draft text WITHOUT persisting it —
 * callers decide the resulting response_status. Shared by redraft_reply (which
 * saves it as 'drafted' for review) and auto_respond (which sends it).
 */
export async function draftResponseForReply(reply_id: number): Promise<string> {
  const db = getDb();
  const reply = db.select().from(replies).where(eq(replies.id, reply_id)).get();
  if (!reply) throw new Error(`reply ${reply_id} not found`);
  if (!reply.classification) throw new Error(`reply ${reply_id} has no classification to draft for`);

  const invite = db.select().from(invites).where(eq(invites.id, reply.invite_id)).get();
  if (!invite) throw new Error(`invite ${reply.invite_id} not found`);

  const event = db.select().from(events).where(eq(events.id, invite.event_id)).get();
  if (!event) throw new Error(`event ${invite.event_id} not found`);

  const contact = db.select().from(contacts).where(eq(contacts.id, invite.contact_id)).get();
  if (!contact) throw new Error(`contact ${invite.contact_id} not found`);

  const style_guide = getSetting('style_guide') ?? DEFAULT_STYLE_GUIDE;

  const prompt = buildRedraftForClassificationPrompt({
    event,
    contact,
    original_invite_text: invite.draft_text ?? '(original invite text not stored)',
    reply_text: reply.wa_message_text,
    classification: reply.classification,
    style_guide,
  });

  const result = await complete(prompt, 500, { json: false });
  logger.info('draft_response_for_reply: model output', {
    reply_id,
    classification: reply.classification,
    in: result.input_tokens,
    out: result.output_tokens,
    cache_read: result.cache_read_input_tokens,
  });

  return parseRedraft(result.text);
}

/**
 * Redraft a reply's response after the operator manually overrode its
 * classification. Unlike classify_reply, this NEVER re-classifies — it honours
 * the classification already on the row (which the operator just set) and only
 * rewrites response_draft to match that judgement. The operator's
 * classification, confidence (pinned to 1), summary, and 'manual' source are
 * left intact.
 */
export async function redraftReplyHandler(job: Job): Promise<void> {
  const { reply_id } = payloadSchema.parse(job.payload);
  const response_draft = await draftResponseForReply(reply_id);

  getDb()
    .update(replies)
    .set({ response_draft, response_status: 'drafted' })
    .where(eq(replies.id, reply_id))
    .run();
}
