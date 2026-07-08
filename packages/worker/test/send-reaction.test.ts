import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@event-drafter/core/migrate';
import { closeDb, getDb } from '@event-drafter/core/db';
import { contacts, events, invites, replies } from '@event-drafter/core/schema';
import { eq } from 'drizzle-orm';
import type { Job } from '@event-drafter/core';

// Only the WA driver is mocked — these tests are about the DB state transitions
// the handler drives, not the browser reaction itself.
const reactToLastInbound = vi.fn();
vi.mock('../src/wa/driver.js', () => ({
  reactToLastInbound: (...a: unknown[]) => reactToLastInbound(...a),
}));

import { sendReactionHandler } from '../src/jobs/send-reaction.js';
import { WaSelectorMismatch } from '../src/wa/session.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'vip-sendreact-test-'));
  process.env.ED_DB_PATH = join(tmp, 'app.db');
  runMigrations();
  reactToLastInbound.mockReset();
});

afterEach(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

function seedReply(): number {
  const db = getDb();
  const ev = db.insert(events).values({ name: 'E', event_date: new Date() }).returning().get();
  const c = db.insert(contacts).values({ first_name: 'A', phone_e164: '+10000000000' }).returning().get();
  const inv = db
    .insert(invites)
    .values({ event_id: ev.id, contact_id: c.id, draft_text: 'hi', status: 'sent' })
    .returning()
    .get();
  const r = db
    .insert(replies)
    .values({
      invite_id: inv.id,
      wa_message_text: 'yes count me in',
      wa_sent_at: new Date(),
      classification: 'yes',
      reaction_status: 'pending',
      reaction_emoji: '\u{1F44D}',
    })
    .returning()
    .get();
  return r.id;
}

const jobFor = (reply_id: number): Job =>
  ({ id: 1, kind: 'send_reaction', payload: { reply_id, emoji: '\u{1F44D}' } }) as unknown as Job;

describe('sendReactionHandler — resolve-on-react', () => {
  it('marks the reply resolved when the reaction lands (drops off unread)', async () => {
    const id = seedReply();
    reactToLastInbound.mockResolvedValue(undefined);

    await sendReactionHandler(jobFor(id));

    const row = getDb().select().from(replies).where(eq(replies.id, id)).get();
    expect(row?.reaction_status).toBe('sent');
    expect(row?.resolved).toBe(true);
    expect(row?.resolved_at).toBeInstanceOf(Date);
  });

  it('leaves the reply UNRESOLVED when the reaction fails (stays in unread to retry)', async () => {
    const id = seedReply();
    reactToLastInbound.mockRejectedValue(new WaSelectorMismatch('reactHoverButton'));

    await expect(sendReactionHandler(jobFor(id))).rejects.toThrow();

    const row = getDb().select().from(replies).where(eq(replies.id, id)).get();
    expect(row?.reaction_status).toBe('failed');
    expect(row?.resolved).toBe(false);
    expect(row?.resolved_at).toBeNull();
  });
});
