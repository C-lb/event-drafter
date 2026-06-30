// packages/web/lib/limbo-read.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@event-drafter/core/migrate';
import { closeDb, getDb } from '@event-drafter/core/db';
import { events, contacts, invites } from '@event-drafter/core/schema';
import { setSetting } from '@event-drafter/core/settings';
import { readLimbo } from './limbo-read';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'ed-limbo-test-'));
  process.env.ED_DB_PATH = join(tmp, 'app.db');
  runMigrations();
});
afterEach(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

let _seq = 0;
function seedInvite(status: string): number {
  const db = getDb();
  const ev = db.insert(events).values({ name: 'Gala', event_date: new Date() }).returning().get();
  const c = db.insert(contacts).values({ first_name: 'Ann', phone_e164: `+1${++_seq}` }).returning().get();
  const inv = db
    .insert(invites)
    .values({ event_id: ev.id, contact_id: c.id, status: status as never, draft_text: 'hi' })
    .returning()
    .get();
  return inv.id;
}

describe('readLimbo', () => {
  it('flags a sending invite even with auto-send off', () => {
    seedInvite('sending');
    setSetting('auto_send_enabled', false);
    const out = readLimbo();
    expect(out.count).toBe(1);
    expect(out.records[0].name).toBe('Ann ');
  });

  it('flags a prefilled invite only when auto-send is on', () => {
    seedInvite('prefilled');
    setSetting('auto_send_enabled', false);
    expect(readLimbo().count).toBe(0);
    setSetting('auto_send_enabled', true);
    expect(readLimbo().count).toBe(1);
  });

  it('ignores approved/sent invites', () => {
    seedInvite('approved');
    seedInvite('sent');
    expect(readLimbo().count).toBe(0);
  });
});
