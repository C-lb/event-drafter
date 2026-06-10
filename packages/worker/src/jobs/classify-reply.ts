import type { Job } from '@vip/core';
import { getDb } from '@vip/core/db';
import { contacts, events, invites, replies } from '@vip/core/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { complete } from '../llm/client.js';
import { buildClassifyAndDraftPrompt, parseClassifyAndDraft } from '../llm/prompts.js';
import { getSetting } from '@vip/core/settings';
import { logger } from '../logger.js';

const payloadSchema = z.object({ reply_id: z.number(), operator_first_name: z.string().optional() });

const DEFAULT_STYLE_GUIDE = 'Brief and warm. 1-3 sentences. No emoji.';

export async function classifyReplyHandler(job: Job): Promise<void> {
  const { reply_id, operator_first_name } = payloadSchema.parse(job.payload);

  const db = getDb();
  const reply = db.select().from(replies).where(eq(replies.id, reply_id)).get();
  if (!reply) throw new Error(`reply ${reply_id} not found`);

  const invite = db.select().from(invites).where(eq(invites.id, reply.invite_id)).get();
  if (!invite) throw new Error(`invite ${reply.invite_id} not found`);

  const event = db.select().from(events).where(eq(events.id, invite.event_id)).get();
  if (!event) throw new Error(`event ${invite.event_id} not found`);

  const contact = db.select().from(contacts).where(eq(contacts.id, invite.contact_id)).get();
  if (!contact) throw new Error(`contact ${invite.contact_id} not found`);

  const style_guide = getSetting('style_guide') ?? DEFAULT_STYLE_GUIDE;

  const prompt = buildClassifyAndDraftPrompt({
    event,
    contact,
    original_invite_text: invite.draft_text ?? '(original invite text not stored)',
    reply_text: reply.wa_message_text,
    style_guide,
    operator_first_name,
  });

  const result = await complete(prompt, 500, { json: true });
  logger.info('classify_reply: model output', {
    reply_id,
    in: result.input_tokens,
    out: result.output_tokens,
    cache_read: result.cache_read_input_tokens,
  });

  const parsed = parseClassifyAndDraft(result.text);

  db.transaction((tx) => {
    tx.update(replies)
      .set({
        classification: parsed.classification,
        classification_confidence: parsed.confidence,
        classification_summary: parsed.summary,
        response_draft: parsed.response_draft,
        response_status: 'drafted',
      })
      .where(eq(replies.id, reply_id))
      .run();
    tx.update(invites)
      .set({ rsvp: parsed.classification === 'unclear' ? 'none' : parsed.classification })
      .where(eq(invites.id, reply.invite_id))
      .run();
  });
}
