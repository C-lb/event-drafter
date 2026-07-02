import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@event-drafter/core/migrate';
import { closeDb } from '@event-drafter/core/db';
import { getSetting } from '@event-drafter/core/settings';
import { beat, startHeartbeat } from '../src/heartbeat.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'ed-hb-')); process.env.ED_DB_PATH = join(tmp, 'app.db'); runMigrations(); });
afterEach(() => { closeDb(); rmSync(tmp, { recursive: true, force: true }); });

describe('heartbeat', () => {
  it('beat() writes a heartbeat with startedAt + pid', () => {
    beat();
    const hb = getSetting('worker_heartbeat');
    expect(hb).toBeTruthy();
    expect(typeof hb!.startedAt).toBe('number');
    expect(typeof hb!.pid).toBe('number');
  });
  it('startHeartbeat() returns a stoppable handle', () => {
    const h = startHeartbeat();
    expect(typeof h.stop).toBe('function');
    h.stop();
  });
});
