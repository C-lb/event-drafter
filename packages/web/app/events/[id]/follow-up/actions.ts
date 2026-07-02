'use server';

import { z } from 'zod';
import { getDb } from '@event-drafter/core/db';
import { contacts, events, follow_ups, invites, replies, message_templates } from '@event-drafter/core/schema';
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
