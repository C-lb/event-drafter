// packages/web/lib/limbo-read.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@event-drafter/core/migrate';
import { closeDb, getDb } from '@event-drafter/core/db';
import { events, contacts, invites, jobs } from '@event-drafter/core/schema';
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

  it('shows a stranded sending invite even when the worker is connected, because its orphan job started before this session', () => {
    // Seed a sending invite
    const invId = seedInvite('sending');
    setSetting('auto_send_enabled', false);

    // The orphan job started at T=1000 (previous session)
    const orphanStartedAt = 1000;
    // Current session started at T=2000 (after the orphan)
    const sessionStartedAt = 2000;

    getDb()
      .insert(jobs)
      .values({
        kind: 'send_message',
        payload: { invite_id: invId },
        status: 'running',
        started_at: new Date(orphanStartedAt),
      })
      .run();

    // Fresh heartbeat: ts=now, startedAt=2000 (this session started after the orphan)
    setSetting('worker_heartbeat', { ts: Date.now(), node: 'test', startedAt: sessionStartedAt, pid: 1 });

    const out = readLimbo();
    expect(out.count).toBe(1);
    expect(out.records.some((r) => r.id === invId)).toBe(true);
  });

  it('excludes the invite currently being sent by this session', () => {
    // Seed a sending invite
    const invId = seedInvite('sending');
    setSetting('auto_send_enabled', false);

    // Current session started at T=1000
    const sessionStartedAt = 1000;
    // The live job started at T=1500 (after session start — claimed by this session)
    const liveJobStartedAt = 1500;

    getDb()
      .insert(jobs)
      .values({
        kind: 'send_message',
        payload: { invite_id: invId },
        status: 'running',
        started_at: new Date(liveJobStartedAt),
      })
      .run();

    setSetting('worker_heartbeat', { ts: Date.now(), node: 'test', startedAt: sessionStartedAt, pid: 1 });

    const out = readLimbo();
    expect(out.records.some((r) => r.id === invId)).toBe(false);
    expect(out.count).toBe(0);
  });
});
