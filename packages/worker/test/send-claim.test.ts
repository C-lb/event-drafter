import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@event-drafter/core/migrate';
import { closeDb, getDb } from '@event-drafter/core/db';
import { contacts, events, follow_ups, invites, replies } from '@event-drafter/core/schema';
import { eq } from 'drizzle-orm';
import {
  claimInviteForSend,
  releaseInviteClaim,
  claimFollowUpForSend,
  claimResponseForSend,
} from '../src/jobs/send-claim.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'vip-claim-test-'));
  process.env.ED_DB_PATH = join(tmp, 'app.db');
  runMigrations();
});

afterEach(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

function seedInvite(status: string): number {
  const db = getDb();
  const ev = db.insert(events).values({ name: 'E', event_date: new Date() }).returning().get();
  const c = db.insert(contacts).values({ first_name: 'A', phone_e164: '+10000000000' }).returning().get();
  const inv = db
    .insert(invites)
    .values({ event_id: ev.id, contact_id: c.id, draft_text: 'hi', status: status as never })
    .returning()
    .get();
  return inv.id;
}

describe('claimInviteForSend()', () => {
  it('claims an approved invite exactly once; a second claim loses', () => {
    const db = getDb();
    const id = seedInvite('approved');

    expect(claimInviteForSend(id)).toBe(true);
    expect(claimInviteForSend(id)).toBe(false);

    const after = db.select().from(invites).where(eq(invites.id, id)).get();
    expect(after?.status).toBe('sending');
  });

  it('does not claim an invite that is not approved', () => {
    const id = seedInvite('drafted');
    expect(claimInviteForSend(id)).toBe(false);
    const after = getDb().select().from(invites).where(eq(invites.id, id)).get();
    expect(after?.status).toBe('drafted');
  });

  it('releaseInviteClaim returns a sending invite to approved (only if still sending)', () => {
    const db = getDb();
    const id = seedInvite('approved');
    claimInviteForSend(id);

    releaseInviteClaim(id);
    expect(db.select().from(invites).where(eq(invites.id, id)).get()?.status).toBe('approved');

    // No-op when the row has moved on (e.g. already sent).
    db.update(invites).set({ status: 'sent' }).where(eq(invites.id, id)).run();
    releaseInviteClaim(id);
    expect(db.select().from(invites).where(eq(invites.id, id)).get()?.status).toBe('sent');
  });
});

describe('claimFollowUpForSend()', () => {
  it('claims an approved follow-up exactly once', () => {
    const db = getDb();
    const invId = seedInvite('sent');
    const fu = db
      .insert(follow_ups)
      .values({ invite_id: invId, draft_text: 'ping', status: 'approved' })
      .returning()
      .get();

    expect(claimFollowUpForSend(fu.id)).toBe(true);
    expect(claimFollowUpForSend(fu.id)).toBe(false);
    expect(db.select().from(follow_ups).where(eq(follow_ups.id, fu.id)).get()?.status).toBe('sending');
  });
});

describe('claimResponseForSend()', () => {
  it('claims an approved reply response exactly once', () => {
    const db = getDb();
    const invId = seedInvite('sent');
    const r = db
      .insert(replies)
      .values({
        invite_id: invId,
        wa_message_text: 'yes!',
        wa_sent_at: new Date(),
        response_draft: 'great',
        response_status: 'approved',
      })
      .returning()
      .get();

    expect(claimResponseForSend(r.id)).toBe(true);
    expect(claimResponseForSend(r.id)).toBe(false);
    expect(db.select().from(replies).where(eq(replies.id, r.id)).get()?.response_status).toBe('sending');
  });
});
