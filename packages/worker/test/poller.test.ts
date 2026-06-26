import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@event-drafter/core/migrate';
import { closeDb, getDb } from '@event-drafter/core/db';
import { jobs } from '@event-drafter/core/schema';
import { eq } from 'drizzle-orm';
import { tick, tryClaimJob } from '../src/poller.js';
import { handlers } from '../src/jobs/index.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'vip-worker-test-'));
  process.env.ED_DB_PATH = join(tmp, 'app.db');
  runMigrations();
});

afterEach(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('tick()', () => {
  it('runs the handler for the oldest queued job and marks succeeded', async () => {
    const db = getDb();
    const spy = vi.fn().mockResolvedValue(undefined);
    handlers.send_message = spy;

    db.insert(jobs).values({ kind: 'send_message', payload: { x: 1 } }).run();
    const did = await tick();

    expect(did).toBe(1);
    expect(spy).toHaveBeenCalledOnce();
    const row = db.select().from(jobs).all()[0];
    expect(row?.status).toBe('succeeded');
    expect(row?.attempts).toBe(1);
  });

  it('marks failed and records error when handler throws', async () => {
    const db = getDb();
    handlers.send_message = vi.fn().mockRejectedValue(new Error('boom'));

    db.insert(jobs).values({ kind: 'send_message', payload: {} }).run();
    await tick();

    const row = db.select().from(jobs).all()[0];
    expect(row?.status).toBe('failed');
    expect(row?.last_error).toContain('boom');
  });

  it('respects run_after — does not pick a job scheduled in the future', async () => {
    const db = getDb();
    const future = new Date(Date.now() + 60_000);
    db.insert(jobs).values({ kind: 'check_replies', payload: {}, run_after: future }).run();

    const did = await tick();
    expect(did).toBe(0);
  });

  it('resets stuck running jobs older than 5 minutes', async () => {
    const db = getDb();
    const stale = new Date(Date.now() - 10 * 60 * 1000);
    const row = db
      .insert(jobs)
      .values({ kind: 'check_replies', payload: {}, status: 'running', started_at: stale })
      .returning()
      .get();

    handlers.check_replies = vi.fn().mockResolvedValue(undefined);
    await tick();

    const after = db.select().from(jobs).where(eq(jobs.id, row.id)).get();
    expect(after?.status).toBe('succeeded');
  });

  it('does NOT auto-reset a stuck running send_message job (would risk double-send)', async () => {
    const db = getDb();
    const stale = new Date(Date.now() - 10 * 60 * 1000);
    const row = db
      .insert(jobs)
      .values({ kind: 'send_message', payload: {}, status: 'running', started_at: stale })
      .returning()
      .get();

    const spy = vi.fn().mockResolvedValue(undefined);
    handlers.send_message = spy;
    await tick();

    const after = db.select().from(jobs).where(eq(jobs.id, row.id)).get();
    expect(after?.status).toBe('running');
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('tick() — concurrency policy', () => {
  it('runs non-send (draft) jobs concurrently in one tick', async () => {
    const db = getDb();
    let active = 0;
    let maxActive = 0;
    let started = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    handlers.draft_invite = vi.fn().mockImplementation(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      started++;
      if (started >= 3) release(); // all three in flight — let them finish
      await gate;
      active--;
    });

    for (let i = 0; i < 3; i++) {
      db.insert(jobs).values({ kind: 'draft_invite', payload: {} }).run();
    }

    const did = await tick();

    expect(did).toBe(3);
    expect(maxActive).toBe(3); // proves they overlapped, not serialized
    const rows = db.select().from(jobs).all();
    expect(rows.every((r) => r.status === 'succeeded')).toBe(true);
  });

  it('processes send-kind jobs one per tick (never concurrently)', async () => {
    const db = getDb();
    const spy = vi.fn().mockResolvedValue(undefined);
    handlers.send_message = spy;

    for (let i = 0; i < 3; i++) {
      db.insert(jobs).values({ kind: 'send_message', payload: {} }).run();
    }

    const did = await tick();

    expect(did).toBe(1);
    expect(spy).toHaveBeenCalledOnce();
    const succeeded = db.select().from(jobs).all().filter((r) => r.status === 'succeeded');
    expect(succeeded).toHaveLength(1);
  });

  it('caps the concurrent batch at ED_DRAFT_CONCURRENCY', async () => {
    const db = getDb();
    process.env.ED_DRAFT_CONCURRENCY = '2';
    const spy = vi.fn().mockResolvedValue(undefined);
    handlers.draft_invite = spy;

    for (let i = 0; i < 5; i++) {
      db.insert(jobs).values({ kind: 'draft_invite', payload: {} }).run();
    }

    const did = await tick();

    expect(did).toBe(2);
    expect(spy).toHaveBeenCalledTimes(2);
    delete process.env.ED_DRAFT_CONCURRENCY;
  });
});

describe('tryClaimJob() — atomic compare-and-swap claim', () => {
  it('claims a queued job once; a second claim of the same job loses', () => {
    const db = getDb();
    const row = db.insert(jobs).values({ kind: 'send_message', payload: {} }).returning().get();

    expect(tryClaimJob(row.id)).toBe(true);
    expect(tryClaimJob(row.id)).toBe(false);

    const after = db.select().from(jobs).where(eq(jobs.id, row.id)).get();
    expect(after?.status).toBe('running');
    // The losing claim must not bump attempts — only the winner ran it.
    expect(after?.attempts).toBe(1);
  });
});
