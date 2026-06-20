import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@event-drafter/core/migrate';
import { closeDb, getDb } from '@event-drafter/core/db';
import { contacts, events, invites } from '@event-drafter/core/schema';
import { eq } from 'drizzle-orm';
import type { Job } from '@event-drafter/core';

// WA driver and cadence are mocked — these tests are about send-once logic,
// not the browser. prefillDraft is gated so we can interleave two runs.
const prefillDraft = vi.fn();
const clickSendInPrefilledChat = vi.fn();
vi.mock('../src/wa/driver.js', () => ({
  prefillDraft: (...a: unknown[]) => prefillDraft(...a),
  clickSendInPrefilledChat: (...a: unknown[]) => clickSendInPrefilledChat(...a),
}));
vi.mock('../src/rate-limit.js', () => ({
  sendDelayMs: () => null,
  jitterMs: () => 0,
}));
vi.mock('@event-drafter/core/settings', () => ({
  getSetting: () => false, // auto-send off — stop after prefill
}));

import { sendMessageHandler } from '../src/jobs/send-message.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'vip-sendmsg-test-'));
  process.env.ED_DB_PATH = join(tmp, 'app.db');
  runMigrations();
  prefillDraft.mockReset();
  clickSendInPrefilledChat.mockReset();
});

afterEach(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

function seedApprovedInvite(): number {
  const db = getDb();
  const ev = db.insert(events).values({ name: 'E', event_date: new Date() }).returning().get();
  const c = db.insert(contacts).values({ first_name: 'A', phone_e164: '+10000000000' }).returning().get();
  const inv = db
    .insert(invites)
    .values({ event_id: ev.id, contact_id: c.id, draft_text: 'hi', status: 'approved' })
    .returning()
    .get();
  return inv.id;
}

const jobFor = (invite_id: number): Job =>
  ({ id: 1, kind: 'send_message', payload: { invite_id } }) as unknown as Job;

describe('sendMessageHandler — single-send guarantee', () => {
  it('delivers an approved invite exactly once and leaves it prefilled', async () => {
    const id = seedApprovedInvite();
    prefillDraft.mockResolvedValue(undefined);

    await sendMessageHandler(jobFor(id));

    expect(prefillDraft).toHaveBeenCalledTimes(1);
    expect(getDb().select().from(invites).where(eq(invites.id, id)).get()?.status).toBe('prefilled');
  });

  it('does NOT deliver twice when two jobs run concurrently for the same invite', async () => {
    const id = seedApprovedInvite();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    prefillDraft.mockImplementation(async () => {
      await gate;
    });

    // Both start synchronously; the claim runs before the awaited prefill, so
    // the second runner must observe the invite already taken.
    const p1 = sendMessageHandler(jobFor(id));
    const p2 = sendMessageHandler(jobFor(id));
    release();
    await Promise.all([p1, p2]);

    expect(prefillDraft).toHaveBeenCalledTimes(1);
    expect(getDb().select().from(invites).where(eq(invites.id, id)).get()?.status).toBe('prefilled');
  });

  it('skips an invite that is not approved', async () => {
    const id = seedApprovedInvite();
    getDb().update(invites).set({ status: 'sent' }).where(eq(invites.id, id)).run();
    prefillDraft.mockResolvedValue(undefined);

    await sendMessageHandler(jobFor(id));

    expect(prefillDraft).not.toHaveBeenCalled();
  });
});
