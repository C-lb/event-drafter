// packages/web/app/replies/classification.test.ts
// Guards the "no future preview for a clear yes/no" contract: marking a reply
// yes or no must NOT enqueue a redraft_reply job (the reply collapses to a
// compact card whose only action is a private follow-up), while maybe/unclear
// still get a fresh draft to send. Also checks the invite RSVP stays in step.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@event-drafter/core/migrate';
import { closeDb, getDb } from '@event-drafter/core/db';
import { events, contacts, invites, replies, jobs } from '@event-drafter/core/schema';
import { eq, and } from 'drizzle-orm';

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

import { setReplyClassification } from './actions';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'ed-classify-test-'));
  process.env.ED_DB_PATH = join(tmp, 'app.db');
  runMigrations();
});
afterEach(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

let _seq = 0;
/** Seed an event/contact/invite/reply and return the reply + invite ids. */
function seedReply(): { reply_id: number; invite_id: number } {
  const db = getDb();
  const ev = db.insert(events).values({ name: 'Gala', event_date: new Date() }).returning().get();
  const c = db.insert(contacts).values({ first_name: 'Ann', phone_e164: `+1${++_seq}` }).returning().get();
  const inv = db
    .insert(invites)
    .values({ event_id: ev.id, contact_id: c.id, status: 'sent' as never })
    .returning()
    .get();
  const rep = db
    .insert(replies)
    .values({
      invite_id: inv.id,
      wa_message_text: 'yes I can make it',
      wa_sent_at: new Date(),
      response_draft: 'See you there!',
      response_status: 'pending',
    })
    .returning()
    .get();
  return { reply_id: rep.id, invite_id: inv.id };
}

function redraftJobCount(reply_id: number): number {
  const rows = getDb().select().from(jobs).where(eq(jobs.kind, 'redraft_reply')).all();
  return rows.filter((j) => (j.payload as { reply_id?: number } | null)?.reply_id === reply_id).length;
}

describe('setReplyClassification', () => {
  it('does NOT enqueue a redraft for a clear yes (no future preview)', async () => {
    const { reply_id, invite_id } = seedReply();

    const res = await setReplyClassification({ reply_id, classification: 'yes' });

    expect(res).toEqual({ ok: true });
    expect(redraftJobCount(reply_id)).toBe(0);
    const inv = getDb().select().from(invites).where(eq(invites.id, invite_id)).get();
    expect(inv?.rsvp).toBe('yes');
  });

  it('does NOT enqueue a redraft for a clear no', async () => {
    const { reply_id } = seedReply();
    await setReplyClassification({ reply_id, classification: 'no' });
    expect(redraftJobCount(reply_id)).toBe(0);
  });

  it('DOES enqueue a redraft for maybe (still needs a reply to send)', async () => {
    const { reply_id } = seedReply();
    await setReplyClassification({ reply_id, classification: 'maybe' });
    expect(redraftJobCount(reply_id)).toBe(1);
  });

  it('DOES enqueue a redraft for unclear', async () => {
    const { reply_id } = seedReply();
    await setReplyClassification({ reply_id, classification: 'unclear' });
    expect(redraftJobCount(reply_id)).toBe(1);
  });

  it('leaves an already-sent reply untouched: no redraft even for maybe', async () => {
    const { reply_id } = seedReply();
    getDb().update(replies).set({ response_status: 'sent' }).where(eq(replies.id, reply_id)).run();
    await setReplyClassification({ reply_id, classification: 'maybe' });
    expect(redraftJobCount(reply_id)).toBe(0);
  });
});
