import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@event-drafter/core/migrate';
import { closeDb, getDb } from '@event-drafter/core/db';
import { events, contacts, invites, replies } from '@event-drafter/core/schema';
import { eq } from 'drizzle-orm';

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

import { listInvitesForFollowUp, saveInviteLogistics } from './actions';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'ed-tfu-logi-'));
  process.env.ED_DB_PATH = join(tmp, 'app.db');
  runMigrations();
});
afterEach(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

function seed() {
  const db = getDb();
  const ev = db.insert(events).values({ name: 'Gala', event_date: new Date() }).returning().get();
  const c1 = db.insert(contacts).values({ first_name: 'Ada', phone_e164: '+6511' }).returning().get();
  const c2 = db.insert(contacts).values({ first_name: 'Bo', phone_e164: '+6512' }).returning().get();
  const i1 = db.insert(invites).values({ event_id: ev.id, contact_id: c1.id, status: 'sent' }).returning().get();
  const i2 = db.insert(invites).values({ event_id: ev.id, contact_id: c2.id, status: 'sent' }).returning().get();
  db.insert(replies).values({ invite_id: i2.id, wa_message_text: 'yes', wa_sent_at: new Date() }).run();
  return { eventId: ev.id, i1: i1.id, i2: i2.id };
}

describe('follow-up logistics actions', () => {
  it('lists the event invitees with a has_reply flag', async () => {
    const { eventId, i1, i2 } = seed();
    const rows = await listInvitesForFollowUp(eventId);
    expect(rows).toHaveLength(2);
    const byId = Object.fromEntries(rows.map((r) => [r.invite_id, r]));
    expect(byId[i1].has_reply).toBe(false);
    expect(byId[i2].has_reply).toBe(true);
    expect(byId[i1].chauffeured).toBe(false);
  });

  it('persists logistics to the invite', async () => {
    const { i1 } = seed();
    const res = await saveInviteLogistics({
      invite_id: i1, chauffeured: true, parking_coupon: false, takes_bus: true, food_pref: 'vegan',
    });
    expect(res).toEqual({ ok: true });
    const inv = getDb().select().from(invites).where(eq(invites.id, i1)).get();
    expect(inv?.chauffeured).toBe(true);
    expect(inv?.takes_bus).toBe(true);
    expect(inv?.food_pref).toBe('vegan');
  });

  it('rejects an unknown invite', async () => {
    const res = await saveInviteLogistics({
      invite_id: 999, chauffeured: true, parking_coupon: false, takes_bus: false, food_pref: null,
    });
    expect(res.ok).toBe(false);
  });

  it('rejects malformed input without throwing', async () => {
    const res = await saveInviteLogistics({ invite_id: -1 });
    expect(res.ok).toBe(false);
  });
});
