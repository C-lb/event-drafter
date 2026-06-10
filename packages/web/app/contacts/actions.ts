'use server';

import { z } from 'zod';
import { getDb } from '@vip/core/db';
import { contacts, invites } from '@vip/core/schema';
import { eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

const editSchema = z.object({
  id: z.number().int().positive(),
  first_name: z.string().min(1).max(80),
  last_name: z.string().max(80).optional().or(z.literal('')),
  phone_e164: z.string().min(3).max(40),
  secondary_phone_e164: z.string().max(40).optional().or(z.literal('')),
  email: z.string().max(120).optional().or(z.literal('')),
  remarks: z.string().max(500).optional().or(z.literal('')),
});

const trim = (s: string | undefined): string | null => {
  const v = (s ?? '').trim();
  return v.length ? v : null;
};

export async function updateContact(input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = editSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid input' };
  const { id, first_name, last_name, phone_e164, secondary_phone_e164, email, remarks } = parsed.data;

  const db = getDb();
  try {
    db.update(contacts)
      .set({
        first_name: first_name.trim(),
        last_name: trim(last_name),
        phone_e164: phone_e164.trim(),
        secondary_phone_e164: trim(secondary_phone_e164),
        email: trim(email),
        remarks: trim(remarks),
        sheet_row_hash: null, // hand-edited row; next sheet sync will refresh
        updated_at: sql`(unixepoch() * 1000)` as unknown as Date,
      })
      .where(eq(contacts.id, id))
      .run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('UNIQUE')) return { ok: false, error: 'Another contact already uses this phone number.' };
    return { ok: false, error: message };
  }
  revalidatePath('/contacts');
  return { ok: true };
}

const deleteSchema = z.object({ id: z.number().int().positive() });

export async function deleteContact(input: unknown): Promise<{ ok: true; cascaded: number } | { ok: false; error: string }> {
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid id' };
  const db = getDb();
  const inviteCount = db
    .select({ n: sql<number>`count(*)` })
    .from(invites)
    .where(eq(invites.contact_id, parsed.data.id))
    .get();
  db.delete(contacts).where(eq(contacts.id, parsed.data.id)).run();
  revalidatePath('/contacts');
  return { ok: true, cascaded: Number(inviteCount?.n ?? 0) };
}

const clearSchema = z.object({ confirm_phrase: z.string() });
const CLEAR_PHRASE = 'DELETE ALL CONTACTS';

export async function clearAllContacts(input: unknown): Promise<{ ok: true; deleted: number } | { ok: false; error: string }> {
  const parsed = clearSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid input' };
  if (parsed.data.confirm_phrase !== CLEAR_PHRASE) {
    return { ok: false, error: `Confirmation phrase must be exactly "${CLEAR_PHRASE}".` };
  }
  const db = getDb();
  const countRow = db.select({ n: sql<number>`count(*)` }).from(contacts).get();
  db.delete(contacts).run();
  revalidatePath('/contacts');
  return { ok: true, deleted: Number(countRow?.n ?? 0) };
}

export async function listContactsAll() {
  const db = getDb();
  return db.select().from(contacts).orderBy(sql`${contacts.first_name} COLLATE NOCASE`).all();
}
