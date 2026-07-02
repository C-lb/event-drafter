import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@event-drafter/core/migrate';
import { closeDb, getDb } from '@event-drafter/core/db';
import { events, contacts, invites, follow_ups, jobs, message_templates } from '@event-drafter/core/schema';

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

import {
  generateTargetedFollowUps,
  createTemplateFollowUps,
  listTemplates,
  saveTemplate,
  deleteTemplate,
} from './actions';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'ed-tfu-gen-'));
  process.env.ED_DB_PATH = join(tmp, 'app.db');
  runMigrations();
});
afterEach(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

function seed() {
  const db = getDb();
  const ev = db.insert(events).values({ name: 'AI Summit', event_date: new Date('2026-08-01') }).returning().get();
  const c = db.insert(contacts).values({ first_name: 'Ada', phone_e164: '+6511' }).returning().get();
  const inv = db
    .insert(invites)
    .values({ event_id: ev.id, contact_id: c.id, status: 'sent', parking_coupon: true, food_pref: 'vegan' })
    .returning()
    .get();
  return { eventId: ev.id, inviteId: inv.id };
}

describe('draft-generation actions', () => {
  it('generateTargetedFollowUps enqueues a job with the right payload', async () => {
    const { eventId, inviteId } = seed();
    const res = await generateTargetedFollowUps({ event_id: eventId, invite_ids: [inviteId], mode: 'tailored' });
    expect(res).toEqual({ ok: true, count: 1 });
    const job = getDb().select().from(jobs).all()[0];
    expect(job?.kind).toBe('generate_targeted_follow_ups');
    expect(job?.payload).toEqual({ event_id: eventId, invite_ids: [inviteId], mode: 'tailored' });
    // template mode drafts are NOT created here
    expect(getDb().select().from(follow_ups).all()).toHaveLength(0);
  });

  it('createTemplateFollowUps renders per invite and inserts drafted follow_ups', async () => {
    const { eventId, inviteId } = seed();
    const res = await createTemplateFollowUps({
      event_id: eventId,
      invite_ids: [inviteId],
      body: 'Hi {first_name}, {parking} Food noted: {food_pref}.',
    });
    expect(res).toEqual({ ok: true, count: 1 });
    const rows = getDb().select().from(follow_ups).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('drafted');
    expect(rows[0]?.draft_text).toContain('Ada');
    expect(rows[0]?.draft_text).toContain('parking coupon');
    expect(rows[0]?.draft_text).toContain('vegan');
  });

  it('createTemplateFollowUps saves a template when asked, and CRUD round-trips', async () => {
    const { eventId, inviteId } = seed();
    await createTemplateFollowUps({
      event_id: eventId, invite_ids: [inviteId], body: 'Reminder for {first_name}', save_as_template: true,
    });
    let list = await listTemplates();
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe('Reminder for {first_name}');

    const saved = await saveTemplate({ name: 'Named', body: 'Body {venue}' });
    expect(saved.ok).toBe(true);
    list = await listTemplates();
    expect(list).toHaveLength(2);

    await deleteTemplate({ id: list[0]!.id });
    expect(await listTemplates()).toHaveLength(1);
  });

  it('createTemplateFollowUps rejects an empty body', async () => {
    const { eventId, inviteId } = seed();
    const res = await createTemplateFollowUps({ event_id: eventId, invite_ids: [inviteId], body: '   ' });
    expect(res.ok).toBe(false);
  });
});
