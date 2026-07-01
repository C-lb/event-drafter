import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@event-drafter/core/migrate';
import { closeDb, getDb } from '@event-drafter/core/db';
import { jobs } from '@event-drafter/core/schema';
import { setSetting } from '@event-drafter/core/settings';
import { eq } from 'drizzle-orm';
import { maybeHandleRestart, __resetRestartStateForTest } from '../src/restart.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'vip-restart-test-'));
  process.env.ED_DB_PATH = join(tmp, 'app.db');
  runMigrations();
  __resetRestartStateForTest();
});

afterEach(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

describe('maybeHandleRestart()', () => {
  it('does nothing when no restart was requested', () => {
    expect(maybeHandleRestart()).toBe(false);
  });

  it('re-queues a stuck running non-send job', () => {
    const db = getDb();
    const row = db
      .insert(jobs)
      .values({ kind: 'draft_invite', payload: {}, status: 'running', started_at: new Date() })
      .returning()
      .get();

    setSetting('worker_restart_requested', { ts: 1000 });
    expect(maybeHandleRestart()).toBe(true);

    const after = db.select().from(jobs).where(eq(jobs.id, row.id)).get();
    expect(after?.status).toBe('queued');
    expect(after?.started_at).toBeNull();
  });

  it('never re-queues a running send job (would risk double-send)', () => {
    const db = getDb();
    const row = db
      .insert(jobs)
      .values({ kind: 'send_message', payload: {}, status: 'running', started_at: new Date() })
      .returning()
      .get();

    setSetting('worker_restart_requested', { ts: 1000 });
    maybeHandleRestart();

    const after = db.select().from(jobs).where(eq(jobs.id, row.id)).get();
    expect(after?.status).toBe('running');
  });

  it('re-runs the scheduler catch-up (enqueues a due reply check)', () => {
    const db = getDb();
    // Reply checks are now time-driven: one is enqueued only once a configured
    // daily time has passed. Configure 00:00 so a check is always due today.
    setSetting('timing_config', { reply_check_times: ['00:00'] });
    setSetting('worker_restart_requested', { ts: 1000 });
    maybeHandleRestart();

    const checkReplies = db.select().from(jobs).where(eq(jobs.kind, 'check_replies')).all();
    expect(checkReplies.length).toBeGreaterThan(0);
  });

  it('fires once per request timestamp, then again only for a newer one', () => {
    setSetting('worker_restart_requested', { ts: 1000 });
    expect(maybeHandleRestart()).toBe(true);
    expect(maybeHandleRestart()).toBe(false); // same ts — already handled

    setSetting('worker_restart_requested', { ts: 2000 });
    expect(maybeHandleRestart()).toBe(true); // newer ts — handle again
  });
});
