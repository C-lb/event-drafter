import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@event-drafter/core/migrate';
import { closeDb, getDb } from '@event-drafter/core/db';
import { events, contacts, invites, follow_ups } from '@event-drafter/core/schema';
import type { Job } from '@event-drafter/core';

// Mock the LLM client so the job does not hit Anthropic.
const completeMock = vi.fn(async () => ({
  text: 'Hi Ada, quick reminder about AI Summit. We have a parking coupon for you.',
  input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
}));
vi.mock('../src/llm/client.js', () => ({ complete: (...a: unknown[]) => completeMock(...a) }));

import { generateTargetedFollowUpsHandler } from '../src/jobs/generate-targeted-follow-ups.js';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'ed-tfu-job-'));
  process.env.ED_DB_PATH = join(tmp, 'app.db');
  runMigrations();
  completeMock.mockClear();
});
afterEach(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

function seed(): { eventId: number; inviteIds: number[] } {
  const db = getDb();
  const ev = db.insert(events).values({ name: 'AI Summit', event_date: new Date() }).returning().get();
  const ids: number[] = [];
  for (let i = 0; i < 2; i++) {
    const c = db.insert(contacts).values({ first_name: `C${i}`, phone_e164: `+65100000${i}` }).returning().get();
    const inv = db
      .insert(invites)
      .values({ event_id: ev.id, contact_id: c.id, status: 'sent', parking_coupon: true })
      .returning()
      .get();
    ids.push(inv.id);
  }
  return { eventId: ev.id, inviteIds: ids };
}

const asJob = (payload: unknown): Job => ({ payload } as unknown as Job);

describe('generateTargetedFollowUpsHandler', () => {
  it('drafts one follow_up per given invite regardless of reply/delay', async () => {
    const { eventId, inviteIds } = seed();
    await generateTargetedFollowUpsHandler(asJob({ event_id: eventId, invite_ids: inviteIds, mode: 'tailored' }));
    const rows = getDb().select().from(follow_ups).all();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === 'drafted')).toBe(true);
    expect(completeMock).toHaveBeenCalledTimes(2);
  });

  it('drafts only the invites named in the payload', async () => {
    const { eventId, inviteIds } = seed();
    await generateTargetedFollowUpsHandler(asJob({ event_id: eventId, invite_ids: [inviteIds[0]], mode: 'general' }));
    const rows = getDb().select().from(follow_ups).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.invite_id).toBe(inviteIds[0]);
  });

  it('no-ops on an empty invite list', async () => {
    const { eventId } = seed();
    await generateTargetedFollowUpsHandler(asJob({ event_id: eventId, invite_ids: [], mode: 'general' }));
    expect(getDb().select().from(follow_ups).all()).toHaveLength(0);
    expect(completeMock).not.toHaveBeenCalled();
  });
});
