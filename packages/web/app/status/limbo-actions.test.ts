// packages/web/app/status/limbo-actions.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@event-drafter/core/migrate';
import { closeDb, getDb } from '@event-drafter/core/db';
import { events, contacts, invites, jobs } from '@event-drafter/core/schema';
import { eq } from 'drizzle-orm';
import { setSetting } from '@event-drafter/core/settings';
import { recoverMarkSent, recoverResend, recoverResendAllPrefilled } from './limbo-actions';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'ed-limboact-test-'));
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
  const inv = db.insert(invites).values({ event_id: ev.id, contact_id: c.id, status: status as never, draft_text: 'hi' }).returning().get();
  return inv.id;
}
function stuckJob(invite_id: number) {
  getDb().insert(jobs).values({ kind: 'send_message', payload: { invite_id }, status: 'running', started_at: new Date() }).run();
}

describe('recovery actions', () => {
  it('mark-sent sets the invite sent and fails the orphan job', async () => {
    const id = seedInvite('sending');
    stuckJob(id);
    await recoverMarkSent({ type: 'invite', id });
    const inv = getDb().select().from(invites).where(eq(invites.id, id)).get();
    expect(inv?.status).toBe('sent');
    const job = getDb().select().from(jobs).where(eq(jobs.status, 'failed')).get();
    expect(job?.last_error).toContain('superseded by operator recovery');
  });

  it('resend re-approves, enqueues a fresh send, fails the orphan job', async () => {
    const id = seedInvite('sending');
    stuckJob(id);
    await recoverResend({ type: 'invite', id });
    const inv = getDb().select().from(invites).where(eq(invites.id, id)).get();
    expect(inv?.status).toBe('approved');
    expect(inv?.prefilled_at).toBeNull();
    const queued = getDb().select().from(jobs).where(eq(jobs.status, 'queued')).all();
    expect(queued.some((j) => j.kind === 'send_message')).toBe(true);
    const failed = getDb().select().from(jobs).where(eq(jobs.status, 'failed')).get();
    expect(failed).toBeTruthy();
  });

  it('bulk resend re-approves every prefilled record', async () => {
    setSetting('auto_send_enabled', true);
    const a = seedInvite('prefilled');
    const b = seedInvite('prefilled');
    seedInvite('sending'); // not prefilled -> untouched by bulk
    const { resent } = await recoverResendAllPrefilled();
    expect(resent).toBe(2);
    const rows = getDb().select().from(invites).all();
    expect(rows.filter((r) => r.id === a || r.id === b).every((r) => r.status === 'approved')).toBe(true);
  });
});
