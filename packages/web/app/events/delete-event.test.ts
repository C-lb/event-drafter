// packages/web/app/events/delete-event.test.ts
// Integration test over the event-delete flow: the confirm-phrase guard, the
// cascade-count contract, and the not-found path. Guards against a future
// client/server confirm-phrase drift (the bug fixed in fe53b65) by asserting
// the server accepts exactly the shared DELETE_CONFIRM_PHRASE and nothing else.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@event-drafter/core/migrate';
import { closeDb, getDb } from '@event-drafter/core/db';
import { events, contacts, invites, follow_ups, replies } from '@event-drafter/core/schema';
import { eq } from 'drizzle-orm';

// revalidatePath needs a Next request context it does not have under vitest.
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

import { deleteEvent } from './actions';
import { DELETE_CONFIRM_PHRASE } from './delete-confirm';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'ed-delevent-test-'));
  process.env.ED_DB_PATH = join(tmp, 'app.db');
  runMigrations();
});
afterEach(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

function seedEvent(): number {
  return getDb().insert(events).values({ name: 'Gala', event_date: new Date() }).returning().get().id;
}

let _seq = 0;
/** Attaches an invite (+ one reply, one follow-up) to an event so we can assert cascade. */
function seedInviteWithChildren(eventId: number): number {
  const db = getDb();
  const c = db.insert(contacts).values({ first_name: 'Ann', phone_e164: `+1${++_seq}` }).returning().get();
  const inv = db
    .insert(invites)
    .values({ event_id: eventId, contact_id: c.id, status: 'sent' as never, draft_text: 'hi' })
    .returning()
    .get();
  db.insert(replies).values({ invite_id: inv.id, wa_message_text: 'yes', wa_sent_at: new Date() }).run();
  db.insert(follow_ups).values({ invite_id: inv.id, draft_text: 'nudge', status: 'draft' as never }).run();
  return inv.id;
}

describe('deleteEvent', () => {
  it('deletes the event and reports the direct invite count when the phrase matches', async () => {
    const id = seedEvent();
    seedInviteWithChildren(id);
    seedInviteWithChildren(id);

    const res = await deleteEvent({ id, confirm_phrase: DELETE_CONFIRM_PHRASE });

    expect(res).toEqual({ ok: true, cascaded: 2 });
    expect(getDb().select().from(events).where(eq(events.id, id)).get()).toBeUndefined();
  });

  it('cascades to invites, replies, and follow-ups', async () => {
    const id = seedEvent();
    seedInviteWithChildren(id);

    await deleteEvent({ id, confirm_phrase: DELETE_CONFIRM_PHRASE });

    const db = getDb();
    expect(db.select().from(invites).all()).toHaveLength(0);
    expect(db.select().from(replies).all()).toHaveLength(0);
    expect(db.select().from(follow_ups).all()).toHaveLength(0);
  });

  it('rejects a wrong confirm phrase and leaves the event intact', async () => {
    const id = seedEvent();

    const res = await deleteEvent({ id, confirm_phrase: 'xxx' }); // wrong case
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain(DELETE_CONFIRM_PHRASE);
    expect(getDb().select().from(events).where(eq(events.id, id)).get()).toBeTruthy();
  });

  it('rejects an empty confirm phrase (guards against a client that skips the gate)', async () => {
    const id = seedEvent();
    const res = await deleteEvent({ id, confirm_phrase: '' });
    expect(res.ok).toBe(false);
    expect(getDb().select().from(events).where(eq(events.id, id)).get()).toBeTruthy();
  });

  it('returns not-found for an unknown id even with the right phrase', async () => {
    const res = await deleteEvent({ id: 999, confirm_phrase: DELETE_CONFIRM_PHRASE });
    expect(res).toEqual({ ok: false, error: 'Event not found.' });
  });

  it('rejects malformed input without throwing', async () => {
    const res = await deleteEvent({ id: -1, confirm_phrase: DELETE_CONFIRM_PHRASE });
    expect(res).toEqual({ ok: false, error: 'invalid input' });
  });
});
