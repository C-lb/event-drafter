import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '../src/migrate.js';
import { closeDb } from '../src/db.js';
import { getSetting, setSetting, deleteSetting } from '../src/settings.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'vip-set-test-'));
  process.env.ED_DB_PATH = join(tmp, 'app.db');
  runMigrations();
});

afterEach(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

describe('settings', () => {
  it('returns null for missing key', () => {
    expect(getSetting('style_guide')).toBeNull();
  });

  it('round-trips a string value', () => {
    setSetting('style_guide', 'warm but brief');
    expect(getSetting('style_guide')).toBe('warm but brief');
  });

  it('round-trips a structured object', () => {
    setSetting('google_tokens', {
      access_token: 'a',
      refresh_token: 'r',
      expiry_date: 12345,
      scope: 'sheets gmail',
    });
    const t = getSetting('google_tokens');
    expect(t?.refresh_token).toBe('r');
    expect(t?.expiry_date).toBe(12345);
  });

  it('upserts existing keys', () => {
    setSetting('style_guide', 'v1');
    setSetting('style_guide', 'v2');
    expect(getSetting('style_guide')).toBe('v2');
  });

  it('deletes', () => {
    setSetting('setup_completed', true);
    deleteSetting('setup_completed');
    expect(getSetting('setup_completed')).toBeNull();
  });
});
