'use server';

import { z } from 'zod';
import { getDb } from '@event-drafter/core/db';
import { contacts, events, follow_ups, invites, jobs, replies, message_templates } from '@event-drafter/core/schema';
import { renderMessageTemplate, deriveTemplateName } from '@event-drafter/core/message-templates';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

export async function listInvitesForFollowUp(event_id: number) {
  const db = getDb();
  const repliedIds = new Set(
    db.select({ id: replies.invite_id }).from(replies).all().map((r) => r.id),
  );
  const rows = db
    .select({
      invite_id: invites.id,
      contact_id: contacts.id,
      first_name: contacts.first_name,
      last_name: contacts.last_name,
      phone_e164: contacts.phone_e164,
      remarks: contacts.remarks,
      rsvp: invites.rsvp,
      chauffeured: invites.chauffeured,
      parking_coupon: invites.parking_coupon,
      takes_bus: invites.takes_bus,
      food_pref: invites.food_pref,
    })
    .from(invites)
    .innerJoin(contacts, eq(invites.contact_id, contacts.id))
    .where(eq(invites.event_id, event_id))
    .orderBy(contacts.first_name)
    .all();
  return rows.map((r) => ({ ...r, has_reply: repliedIds.has(r.invite_id) }));
}

const logisticsSchema = z.object({
  invite_id: z.number().int().positive(),
  chauffeured: z.boolean(),
  parking_coupon: z.boolean(),
  takes_bus: z.boolean(),
  food_pref: z.string().max(200).nullable().optional(),
});

export async function saveInviteLogistics(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = logisticsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid input' };
  const { invite_id, chauffeured, parking_coupon, takes_bus, food_pref } = parsed.data;

  const db = getDb();
  const inv = db.select().from(invites).where(eq(invites.id, invite_id)).get();
  if (!inv) return { ok: false, error: 'Invite not found.' };

  db.update(invites)
    .set({ chauffeured, parking_coupon, takes_bus, food_pref: food_pref?.trim() || null })
    .where(eq(invites.id, invite_id))
    .run();
  revalidatePath(`/events/${inv.event_id}/follow-up`);
  return { ok: true };
}

export async function listTemplates() {
  const db = getDb();
  return db.select().from(message_templates).orderBy(sql`${message_templates.updated_at} DESC`).all();
}

const saveTemplateSchema = z.object({
  name: z.string().max(120).optional(),
  body: z.string().min(1, 'Template body is empty.').max(4000),
});

export async function saveTemplate(
  input: unknown,
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const parsed = saveTemplateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid input' };
  const { name, body } = parsed.data;
  const db = getDb();
  const row = db
    .insert(message_templates)
    .values({ name: name?.trim() || deriveTemplateName(body), body })
    .returning()
    .get();
  return { ok: true, id: row.id };
}

const deleteTemplateSchema = z.object({ id: z.number().int().positive() });
export async function deleteTemplate(input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = deleteTemplateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid input' };
  getDb().delete(message_templates).where(eq(message_templates.id, parsed.data.id)).run();
  return { ok: true };
}

const generateSchema = z.object({
  event_id: z.number().int().positive(),
  invite_ids: z.array(z.number().int().positive()).min(1, 'Pick at least one contact.'),
  mode: z.enum(['general', 'tailored']),
});

export async function generateTargetedFollowUps(
  input: unknown,
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const parsed = generateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid input' };
  const { event_id, invite_ids, mode } = parsed.data;
  const db = getDb();
  db.insert(jobs).values({ kind: 'generate_targeted_follow_ups', payload: { event_id, invite_ids, mode } }).run();
  return { ok: true, count: invite_ids.length };
}

const templateGenSchema = z.object({
  event_id: z.number().int().positive(),
  invite_ids: z.array(z.number().int().positive()).min(1, 'Pick at least one contact.'),
  body: z.string().min(1, 'Template body is empty.').max(4000),
  save_as_template: z.boolean().optional(),
  template_name: z.string().max(120).optional(),
});

export async function createTemplateFollowUps(
  input: unknown,
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const parsed = templateGenSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid input' };
  const { event_id, invite_ids, body, save_as_template, template_name } = parsed.data;
  if (!body.trim()) return { ok: false, error: 'Template body is empty.' };

  const db = getDb();
  const event = db.select().from(events).where(eq(events.id, event_id)).get();
  if (!event) return { ok: false, error: 'Event not found.' };

  const rows = db
    .select({
      invite_id: invites.id,
      first_name: contacts.first_name,
      last_name: contacts.last_name,
      chauffeured: invites.chauffeured,
      parking_coupon: invites.parking_coupon,
      takes_bus: invites.takes_bus,
      food_pref: invites.food_pref,
    })
    .from(invites)
    .innerJoin(contacts, eq(invites.contact_id, contacts.id))
    .where(and(eq(invites.event_id, event_id), inArray(invites.id, invite_ids)))
    .all();

  let count = 0;
  db.transaction((tx) => {
    for (const r of rows) {
      const draft = renderMessageTemplate(body, {
        first_name: r.first_name,
        last_name: r.last_name,
        event_name: event.name,
        event_date: event.event_date,
        venue: event.venue,
        food_pref: r.food_pref,
        chauffeured: r.chauffeured,
        parking_coupon: r.parking_coupon,
        takes_bus: r.takes_bus,
      });
      tx.insert(follow_ups).values({ invite_id: r.invite_id, draft_text: draft, status: 'drafted' }).run();
      count++;
    }
    if (save_as_template && count > 0) {
      tx.insert(message_templates).values({ name: template_name?.trim() || deriveTemplateName(body), body }).run();
    }
  });

  revalidatePath('/follow-ups');
  return { ok: true, count };
}
