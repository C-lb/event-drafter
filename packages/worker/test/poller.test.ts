import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@event-drafter/core/migrate';
import { closeDb, getDb } from '@event-drafter/core/db';
import { jobs } from '@event-drafter/core/schema';
import { eq } from 'drizzle-orm';
import { tick } from '../src/poller.js';
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
});
