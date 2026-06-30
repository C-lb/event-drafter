import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@event-drafter/core/migrate';
import { closeDb } from '@event-drafter/core/db';
import { setSetting } from '@event-drafter/core/settings';
import { isSafetyStopped } from '../src/poller.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'ed-safety-'));
  process.env.ED_DB_PATH = join(tmp, 'app.db');
  runMigrations();
});

afterEach(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

describe('isSafetyStopped', () => {
  it('is false when unset', () => {
    expect(isSafetyStopped()).toBe(false);
  });
  it('is true once engaged', () => {
    setSetting('worker_safety_stop', { engaged: true, ts: Date.now() });
    expect(isSafetyStopped()).toBe(true);
  });
  it('is false once released', () => {
    setSetting('worker_safety_stop', { engaged: false, ts: Date.now() });
    expect(isSafetyStopped()).toBe(false);
  });
});
