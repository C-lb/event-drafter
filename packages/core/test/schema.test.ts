import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '../src/migrate.js';
import { closeDb, getDb } from '../src/db.js';
import { contacts, events, invites, replies, follow_ups, jobs, wa_chat_cursors } from '../src/schema/index.js';
import { eq } from 'drizzle-orm';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'vip-test-'));
  process.env.VIP_DB_PATH = join(tmp, 'app.db');
  runMigrations();
});

afterEach(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

describe('schema smoke', () => {
  it('inserts and selects a contact', () => {
    const db = getDb();
    db.insert(contacts).values({ first_name: 'Ada', last_name: 'Lovelace', phone_e164: '+6512345678' }).run();
    const rows = db.select().from(contacts).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.first_name).toBe('Ada');
    expect(rows[0]?.last_name).toBe('Lovelace');
  });

  it('enforces unique phone_e164', () => {
    const db = getDb();
    db.insert(contacts).values({ first_name: 'A', phone_e164: '+6500000000' }).run();
    expect(() =>
      db.insert(contacts).values({ first_name: 'B', phone_e164: '+6500000000' }).run(),
    ).toThrow();
  });

  it('cascades invite delete from event', () => {
    const db = getDb();
    const c = db.insert(contacts).values({ first_name: 'A', phone_e164: '+651' }).returning().get();
    const e = db.insert(events).values({ name: 'Gala', event_date: new Date() }).returning().get();
    db.insert(invites).values({ event_id: e.id, contact_id: c.id }).run();
    db.delete(events).where(eq(events.id, e.id)).run();
    expect(db.select().from(invites).all()).toHaveLength(0);
  });

  it('enforces UNIQUE (event_id, contact_id) on invites', () => {
    const db = getDb();
    const c = db.insert(contacts).values({ first_name: 'A', phone_e164: '+652' }).returning().get();
    const e = db.insert(events).values({ name: 'Gala', event_date: new Date() }).returning().get();
    db.insert(invites).values({ event_id: e.id, contact_id: c.id }).run();
    expect(() =>
      db.insert(invites).values({ event_id: e.id, contact_id: c.id }).run(),
    ).toThrow();
  });

  it('inserts into every remaining table without error', () => {
    const db = getDb();
    const c = db.insert(contacts).values({ first_name: 'A', phone_e164: '+653' }).returning().get();
    const e = db.insert(events).values({ name: 'Gala', event_date: new Date() }).returning().get();
    const i = db.insert(invites).values({ event_id: e.id, contact_id: c.id }).returning().get();
    db.insert(replies).values({ invite_id: i.id, wa_message_text: 'yes', wa_sent_at: new Date() }).run();
    db.insert(follow_ups).values({ invite_id: i.id, draft_text: 'hi again' }).run();
    db.insert(jobs).values({ kind: 'send_message', payload: { invite_id: i.id } }).run();
    db.insert(wa_chat_cursors).values({ contact_id: c.id, last_seen_wa_sent_at: new Date() }).run();
    expect(db.select().from(jobs).all()).toHaveLength(1);
  });
});
