import type { Job } from '@event-drafter/core';
import { getDb } from '@event-drafter/core/db';
import { contacts, events, invites, replies } from '@event-drafter/core/schema';
import { and, eq, ne, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { complete } from '../llm/client.js';
import { buildClassifyAndDraftPrompt, parseClassifyAndDraft } from '../llm/prompts.js';
import { getSetting } from '@event-drafter/core/settings';
import { logger } from '../logger.js';

const payloadSchema = z.object({ reply_id: z.number(), operator_first_name: z.string().optional() });

const DEFAULT_STYLE_GUIDE = 'Brief and warm. 1-3 sentences. No emoji.';

// How many past operator corrections to feed the classifier as examples. Small
// enough to stay cheap on tokens; recent-first so the model tracks the
// operator's latest judgement.
const MAX_LEARNED_EXAMPLES = 15;

/**
 * The operator's past manual classifications, newest first and de-duplicated,
 * used as few-shot examples so the model tags similar replies the same way. We
 * read straight from the replies table (classification_source = 'manual') — the
 * override history IS the training signal, no separate store needed.
 */
function gatherLearnedExamples(excludeReplyId: number): Array<{ text: string; classification: string }> {
  const rows = getDb()
    .select({ text: replies.wa_message_text, classification: replies.classification })
    .from(replies)
    .where(
      and(
        eq(replies.classification_source, 'manual'),
        isNotNull(replies.classification),
        ne(replies.id, excludeReplyId),
      ),
    )
    .orderBy(sql`${replies.id} DESC`)
    .limit(MAX_LEARNED_EXAMPLES * 3)
    .all();

  const seen = new Set<string>();
  const examples: Array<{ text: string; classification: string }> = [];
  for (const r of rows) {
    if (!r.text || !r.classification) continue;
    const key = `${r.text.trim().toLowerCase()}::${r.classification}`;
    if (seen.has(key)) continue;
    seen.add(key);
    examples.push({ text: r.text, classification: r.classification });
    if (examples.length >= MAX_LEARNED_EXAMPLES) break;
  }
  return examples;
}

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

  const examples = gatherLearnedExamples(reply_id);
  if (examples.length > 0) {
    logger.info('classify_reply: using learned examples', { reply_id, count: examples.length });
  }

  const prompt = buildClassifyAndDraftPrompt({
    event,
    contact,
    original_invite_text: invite.draft_text ?? '(original invite text not stored)',
    reply_text: reply.wa_message_text,
    style_guide,
    operator_first_name,
    examples,
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
        classification_source: 'llm',
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
