// packages/web/app/status/limbo-actions.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@event-drafter/core/migrate';
import { closeDb, getDb } from '@event-drafter/core/db';
import { events, contacts, invites, follow_ups, replies, jobs } from '@event-drafter/core/schema';
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
function seedFollowUp(invite_id: number, status: string): number {
  const fu = getDb()
    .insert(follow_ups)
    .values({ invite_id, draft_text: 'following up', status: status as never })
    .returning()
    .get();
  return fu.id;
}
function seedReply(invite_id: number): number {
  const r = getDb()
    .insert(replies)
    .values({ invite_id, wa_message_text: 'yes pls', wa_sent_at: new Date(), response_status: 'sending' as never })
    .returning()
    .get();
  return r.id;
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

  it('follow_up resend re-approves and enqueues send_follow_up', async () => {
    const invId = seedInvite('approved');
    const fuId = seedFollowUp(invId, 'sending');
    await recoverResend({ type: 'follow_up', id: fuId });
    const fu = getDb().select().from(follow_ups).where(eq(follow_ups.id, fuId)).get();
    expect(fu?.status).toBe('approved');
    expect(fu?.prefilled_at).toBeNull();
    const queued = getDb().select().from(jobs).where(eq(jobs.status, 'queued')).all();
    expect(queued.some((j) => j.kind === 'send_follow_up')).toBe(true);
  });

  it('reply mark-sent sets response_status=sent and response_sent_at', async () => {
    const invId = seedInvite('sent');
    const rId = seedReply(invId);
    await recoverMarkSent({ type: 'reply', id: rId });
    const reply = getDb().select().from(replies).where(eq(replies.id, rId)).get();
    expect(reply?.response_status).toBe('sent');
    expect(reply?.response_sent_at).not.toBeNull();
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
