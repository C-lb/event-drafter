import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '../src/migrate.js';
import { closeDb, getDb } from '../src/db.js';
import { contacts, events, invites, message_templates } from '../src/schema/index.js';
import { eq } from 'drizzle-orm';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'ed-tfu-schema-'));
  process.env.ED_DB_PATH = join(tmp, 'app.db');
  runMigrations();
});
afterEach(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

describe('targeted follow-up schema', () => {
  it('invites carry logistics columns with sane defaults', () => {
    const db = getDb();
    const ev = db.insert(events).values({ name: 'Gala', event_date: new Date() }).returning().get();
    const c = db.insert(contacts).values({ first_name: 'Ada', phone_e164: '+6512345678' }).returning().get();
    const inv = db.insert(invites).values({ event_id: ev.id, contact_id: c.id }).returning().get();
    expect(inv.chauffeured).toBe(false);
    expect(inv.parking_coupon).toBe(false);
    expect(inv.takes_bus).toBe(false);
    expect(inv.food_pref).toBeNull();

    db.update(invites)
      .set({ takes_bus: true, food_pref: 'vegetarian' })
      .where(eq(invites.id, inv.id))
      .run();
    const updated = db.select().from(invites).where(eq(invites.id, inv.id)).get();
    expect(updated?.takes_bus).toBe(true);
    expect(updated?.food_pref).toBe('vegetarian');
  });

  it('message_templates round-trips', () => {
    const db = getDb();
    const row = db
      .insert(message_templates)
      .values({ name: 'Parking note', body: 'Hi {first_name}, {parking}' })
      .returning()
      .get();
    expect(row.id).toBeGreaterThan(0);
    expect(row.name).toBe('Parking note');
    expect(row.body).toContain('{parking}');
  });
});
