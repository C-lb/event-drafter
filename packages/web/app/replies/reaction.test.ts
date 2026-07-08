// packages/web/app/replies/reaction.test.ts
// Guards the reactToReply action: it marks the reply 'pending' with the chosen
// emoji and enqueues exactly one send_reaction job, is idempotent for an
// already-sent emoji, and refuses to double-queue while one is in flight.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@event-drafter/core/migrate';
import { closeDb, getDb } from '@event-drafter/core/db';
import { events, contacts, invites, replies, jobs } from '@event-drafter/core/schema';
import { eq } from 'drizzle-orm';

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

import { reactToReply } from './actions';

const THUMB = '\u{1F44D}';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'ed-reaction-test-'));
  process.env.ED_DB_PATH = join(tmp, 'app.db');
  runMigrations();
});
afterEach(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

let _seq = 0;
function seedReply(): number {
  const db = getDb();
  const ev = db.insert(events).values({ name: 'Gala', event_date: new Date() }).returning().get();
  const c = db.insert(contacts).values({ first_name: 'Ann', phone_e164: `+1${++_seq}` }).returning().get();
  const inv = db
    .insert(invites)
    .values({ event_id: ev.id, contact_id: c.id, status: 'sent' as never })
    .returning()
    .get();
  return db
    .insert(replies)
    .values({ invite_id: inv.id, wa_message_text: 'yes!', wa_sent_at: new Date(), classification: 'yes' })
    .returning()
    .get().id;
}

function reactionJobs(reply_id: number) {
  return getDb()
    .select()
    .from(jobs)
    .where(eq(jobs.kind, 'send_reaction'))
    .all()
    .filter((j) => (j.payload as { reply_id?: number } | null)?.reply_id === reply_id);
}

describe('reactToReply', () => {
  it('marks the reply pending and enqueues one send_reaction job', async () => {
    const reply_id = seedReply();

    const res = await reactToReply({ reply_id, emoji: THUMB });

    expect(res).toEqual({ ok: true });
    const row = getDb().select().from(replies).where(eq(replies.id, reply_id)).get();
    expect(row?.reaction_status).toBe('pending');
    expect(row?.reaction_emoji).toBe(THUMB);
    const js = reactionJobs(reply_id);
    expect(js).toHaveLength(1);
    expect((js[0]!.payload as { emoji?: string }).emoji).toBe(THUMB);
  });

  it('rejects an unknown emoji', async () => {
    const reply_id = seedReply();
    const res = await reactToReply({ reply_id, emoji: '🤡' });
    expect(res.ok).toBe(false);
    expect(reactionJobs(reply_id)).toHaveLength(0);
  });

  it('will not double-queue while a reaction is already sending', async () => {
    const reply_id = seedReply();
    getDb().update(replies).set({ reaction_status: 'sending' }).where(eq(replies.id, reply_id)).run();
    const res = await reactToReply({ reply_id, emoji: THUMB });
    expect(res.ok).toBe(false);
    expect(reactionJobs(reply_id)).toHaveLength(0);
  });

  it('is a no-op when already reacted with the same emoji', async () => {
    const reply_id = seedReply();
    getDb()
      .update(replies)
      .set({ reaction_status: 'sent', reaction_emoji: THUMB })
      .where(eq(replies.id, reply_id))
      .run();
    const res = await reactToReply({ reply_id, emoji: THUMB });
    expect(res).toEqual({ ok: true });
    expect(reactionJobs(reply_id)).toHaveLength(0);
  });
});
