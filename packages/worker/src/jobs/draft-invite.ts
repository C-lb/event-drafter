import type { Job } from '@vip/core';
import { getDb } from '@vip/core/db';
import { contacts, events, invites } from '@vip/core/schema';
import { getSetting } from '@vip/core/settings';
import { and, eq, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { complete, MODEL } from '../llm/client.js';
import { buildDraftPrompt, type AttendanceFact } from '../llm/prompts.js';
import { logger } from '../logger.js';

const payloadSchema = z.object({
  event_id: z.number(),
  contact_id: z.number(),
  operator_first_name: z.string().optional(),
});

const DEFAULT_STYLE_GUIDE = 'Warm but brief. 2-4 sentences. No emoji. Sign off with first name only.';

export async function draftInviteHandler(job: Job): Promise<void> {
  const { event_id, contact_id, operator_first_name } = payloadSchema.parse(job.payload);

  const db = getDb();
  const event = db.select().from(events).where(eq(events.id, event_id)).get();
  if (!event) throw new Error(`event ${event_id} not found`);

  const contact = db.select().from(contacts).where(eq(contacts.id, contact_id)).get();
  if (!contact) throw new Error(`contact ${contact_id} not found`);

  const history = db
    .select({
      event_name: events.name,
      event_date: events.event_date,
      attended: invites.attended,
      notes: invites.attended_notes,
    })
    .from(invites)
    .innerJoin(events, eq(invites.event_id, events.id))
    .where(and(eq(invites.contact_id, contact_id), isNotNull(invites.sent_at)))
    .orderBy(events.event_date)
    .limit(3)
    .all();

  const attendance_history: AttendanceFact[] = history
    .filter((h) => h.event_name)
    .map((h) => ({
      event_name: h.event_name,
      event_date: h.event_date as Date,
      attended: Boolean(h.attended),
      notes: h.notes,
    }));

  const style_guide = getSetting('style_guide') ?? DEFAULT_STYLE_GUIDE;
  const prompt = buildDraftPrompt({
    event,
    contact,
    attendance_history,
    style_guide,
    operator_first_name,
  });

  const result = await complete(prompt, 600);
  logger.info('draft_invite generated', {
    event_id, contact_id,
    in: result.input_tokens, out: result.output_tokens,
    cache_read: result.cache_read_input_tokens, cache_write: result.cache_creation_input_tokens,
  });

  const existing = db
    .select()
    .from(invites)
    .where(and(eq(invites.event_id, event_id), eq(invites.contact_id, contact_id)))
    .get();

  const draft_text = result.text.trim();
  const generation_meta = {
    model: MODEL,
    input_tokens: result.input_tokens,
    output_tokens: result.output_tokens,
    cache_read_input_tokens: result.cache_read_input_tokens,
    cache_creation_input_tokens: result.cache_creation_input_tokens,
  };

  if (existing) {
    db.update(invites)
      .set({
        draft_text,
        draft_generated_at: new Date(),
        status: existing.status === 'sent' ? 'sent' : 'drafted',
        generation_meta,
      })
      .where(eq(invites.id, existing.id))
      .run();
  } else {
    db.insert(invites).values({
      event_id, contact_id,
      draft_text,
      draft_generated_at: new Date(),
      status: 'drafted',
      generation_meta,
    }).run();
  }
}
