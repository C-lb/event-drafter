import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@event-drafter/core/migrate';
import { closeDb } from '@event-drafter/core/db';
import { setSetting } from '@event-drafter/core/settings';
import { getRateLimitConfig, RATE_LIMIT_DEFAULTS } from '../src/rate-limit.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'ed-rl-')); process.env.ED_DB_PATH = join(tmp, 'app.db'); runMigrations(); });
afterEach(() => { closeDb(); rmSync(tmp, { recursive: true, force: true }); });

describe('getRateLimitConfig', () => {
  it('returns defaults when unset', () => {
    expect(getRateLimitConfig()).toEqual(RATE_LIMIT_DEFAULTS);
  });
  it('overlays a partial override onto the defaults', () => {
    setSetting('rate_limit_config', { minGapMs: 30_000, maxSendsPerHour: 40 });
    const c = getRateLimitConfig();
    expect(c.minGapMs).toBe(30_000);
    expect(c.maxSendsPerHour).toBe(40);
    expect(c.batchLimit).toBe(RATE_LIMIT_DEFAULTS.batchLimit); // untouched
  });
  it('ignores invalid values and keeps max >= min', () => {
    setSetting('rate_limit_config', { minGapMs: -5, maxGapMs: 1, batchLimit: 0 as unknown as number });
    const c = getRateLimitConfig();
    expect(c.minGapMs).toBe(RATE_LIMIT_DEFAULTS.minGapMs); // -5 rejected
    expect(c.maxGapMs).toBeGreaterThanOrEqual(c.minGapMs);  // clamped up
    expect(c.batchLimit).toBe(RATE_LIMIT_DEFAULTS.batchLimit); // 0 rejected
  });
});
