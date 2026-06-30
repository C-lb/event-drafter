# Adjustable rate limiter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Let the operator tune the WhatsApp sending rate limiter from the UI (the six knobs that are hand-edited in code today), applied live by the worker without a restart, with amber warnings when a value is more aggressive than the recommended-safe default. Also fix a heartbeat bug so a long job no longer makes the worker look offline.

**Architecture:** A `rate_limit_config` setting (partial override) is merged over the existing hardcoded defaults by a new `getRateLimitConfig()` in `packages/worker/src/rate-limit.ts`; every rate-limit function reads it per-call, so a saved change takes effect on the next send. A `/settings/sending` page edits the values in human units (seconds/minutes/counts), validated, saved to `settings`. Separately, the worker heartbeat moves to an independent timer so it keeps beating while a tick runs a long job.

**Tech Stack:** Drizzle/SQLite settings, the worker poll loop, Next.js server actions + a client form, the existing anti-vibecode UI classes.

## Global Constraints

- Setting: `rate_limit_config: Partial<{ minGapMs: number; maxGapMs: number; batchLimit: number; cooldownMinMs: number; cooldownMaxMs: number; maxSendsPerHour: number }>` — a partial override; any missing/invalid field falls back to the default.
- Defaults (the current constants, keep as the fallback): `minGapMs 10000`, `maxGapMs 15000`, `batchLimit 8`, `cooldownMinMs 900000` (15 min), `cooldownMaxMs 1800000` (30 min), `maxSendsPerHour 18`.
- The worker reads config PER CALL (like `ED_DRAFT_CONCURRENCY` is read per tick), so changes apply with no restart.
- Recommended-safe thresholds (warn in the UI when MORE aggressive, do NOT block): `minGap < 10s`, `maxSendsPerHour > 18`, `cooldownMin < 15 min`, `batchLimit > 8`. The chosen behavior is allow-any-value-with-amber-warning.
- Validation on save (server, zod, in ms): every field a positive integer; `minGapMs <= maxGapMs`; `cooldownMinMs <= cooldownMaxMs`; `batchLimit >= 1`; `maxSendsPerHour >= 1`; sane upper bounds (gaps <= 24h, cooldowns <= 24h).
- UI in human units: gaps in seconds, cooldowns in minutes, batch + hourly as counts. Convert to/from ms at the form boundary.
- House anti-vibecode rules: amber = the warning semantic only; sentence-case; no em dashes; every button has loading/disabled state; one accent.
- Core consumed from `dist/` — rebuild core after editing it. Commit per task; push at the end.

---

### Task 1: Heartbeat keeps beating during long jobs

**Problem:** `beat()` is only called at the top of the poll loop, so a tick that runs a long job (a WhatsApp scan > 15s) lets the heartbeat go stale and the UI shows the worker "offline" while it is actually busy.

**Files:**
- Modify: `packages/worker/src/heartbeat.ts` (add a `startHeartbeat()` interval)
- Modify: `packages/worker/src/index.ts` (start it once at boot)
- Modify: `packages/worker/src/poller.ts` (the per-loop `beat()` is now redundant but harmless; leave it OR remove — see step)
- Test: `packages/worker/test/heartbeat.test.ts`

- [ ] **Step 1: Test (red).** `packages/worker/test/heartbeat.test.ts` — assert `beat()` writes a fresh `worker_heartbeat` and that a second immediate `beat()` is throttled (no change within the interval), using the temp-DB harness. Also assert `startHeartbeat()` returns a handle with `.stop()` (a `clearInterval` wrapper) so it's testable without leaking a timer.

```ts
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
```
> Note: `beat()`'s 5s throttle uses module state; the first `beat()` in a fresh module always writes. Don't assert the throttle across tests (module state persists) — keep the assertions above.

- [ ] **Step 2: Run → fail** (`startHeartbeat` not exported). `npm -w @event-drafter/worker run test -- --run heartbeat`.

- [ ] **Step 3: Implement.** In `heartbeat.ts`, add an interval starter that calls `beat()` every 5s regardless of the poll loop:
```ts
export interface HeartbeatHandle { stop(): void; }

/** Beats every 5s independent of the poll loop, so a long-running job does not
 *  let the heartbeat go stale (which would show the worker as offline while it
 *  is actually busy). Returns a handle to stop the timer (tests / shutdown). */
export function startHeartbeat(): HeartbeatHandle {
  beat(); // immediate first beat
  const id = setInterval(() => beat(), 5000);
  if (typeof id === 'object' && 'unref' in id) (id as { unref: () => void }).unref();
  return { stop: () => clearInterval(id) };
}
```

- [ ] **Step 4: Start it at boot.** In `packages/worker/src/index.ts`, after `startScheduler()` (and before `runForever()`), add `startHeartbeat()` (import it). Leave the `beat()` call inside `runForever` as-is (harmless; the throttle dedupes). This guarantees beats continue even while `tick()` is inside a long job.

- [ ] **Step 5: Run → pass**, then full worker suite: `npm -w @event-drafter/worker run test`.

- [ ] **Step 6: Commit.**
```bash
git add packages/worker
git commit -m "fix(worker): beat on an independent interval so long jobs don't read as offline"
```

---

### Task 2: Settings-backed rate-limit config in the worker

**Files:**
- Modify: `packages/core/src/schema/settings.ts` (add `'rate_limit_config'` to `SETTING_KEYS`)
- Modify: `packages/core/src/settings.ts` (add the `rate_limit_config` type to `SettingTypes`)
- Modify: `packages/worker/src/rate-limit.ts` (add `getRateLimitConfig()`, refactor all functions to use it)
- Modify: `packages/worker/test/` — add `packages/worker/test/rate-limit-config.test.ts`

**Interfaces:**
- Produces: `interface RateLimitConfig { minGapMs; maxGapMs; batchLimit; cooldownMinMs; cooldownMaxMs; maxSendsPerHour }`, `getRateLimitConfig(): RateLimitConfig`, `RATE_LIMIT_DEFAULTS`.

- [ ] **Step 1: Register the setting.** In `schema/settings.ts` add `'rate_limit_config'` to `SETTING_KEYS`. In `settings.ts` add to `SettingTypes`:
```ts
rate_limit_config: Partial<{ minGapMs: number; maxGapMs: number; batchLimit: number; cooldownMinMs: number; cooldownMaxMs: number; maxSendsPerHour: number }>;
```

- [ ] **Step 2: Test (red).** `packages/worker/test/rate-limit-config.test.ts`:
```ts
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
```
Run → fail.

- [ ] **Step 3: Implement `getRateLimitConfig` + refactor.** In `rate-limit.ts`:
```ts
import { getSetting } from '@event-drafter/core/settings';

export interface RateLimitConfig {
  minGapMs: number; maxGapMs: number; batchLimit: number;
  cooldownMinMs: number; cooldownMaxMs: number; maxSendsPerHour: number;
}

export const RATE_LIMIT_DEFAULTS: RateLimitConfig = {
  minGapMs: 10_000, maxGapMs: 15_000, batchLimit: 8,
  cooldownMinMs: 15 * 60_000, cooldownMaxMs: 30 * 60_000, maxSendsPerHour: 18,
};

/** Settings override merged over defaults; invalid fields fall back. Read per
 *  call so a saved change applies on the next send (no worker restart). */
export function getRateLimitConfig(): RateLimitConfig {
  const o = (getSetting('rate_limit_config') ?? {}) as Partial<RateLimitConfig>;
  const pos = (v: unknown, d: number) =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : d;
  const c: RateLimitConfig = {
    minGapMs: pos(o.minGapMs, RATE_LIMIT_DEFAULTS.minGapMs),
    maxGapMs: pos(o.maxGapMs, RATE_LIMIT_DEFAULTS.maxGapMs),
    batchLimit: pos(o.batchLimit, RATE_LIMIT_DEFAULTS.batchLimit),
    cooldownMinMs: pos(o.cooldownMinMs, RATE_LIMIT_DEFAULTS.cooldownMinMs),
    cooldownMaxMs: pos(o.cooldownMaxMs, RATE_LIMIT_DEFAULTS.cooldownMaxMs),
    maxSendsPerHour: pos(o.maxSendsPerHour, RATE_LIMIT_DEFAULTS.maxSendsPerHour),
  };
  if (c.maxGapMs < c.minGapMs) c.maxGapMs = c.minGapMs;
  if (c.cooldownMaxMs < c.cooldownMinMs) c.cooldownMaxMs = c.cooldownMinMs;
  return c;
}
```
Then replace every use of the module constants (`MIN_GAP_MS`, `MAX_GAP_MS`, `BATCH_LIMIT`, `COOLDOWN_MIN_MS`, `COOLDOWN_MAX_MS`, `MAX_SENDS_PER_HOUR`) inside `jitterMs`, `cooldownMs`, `consecutiveSendsInBatch`, `sendDelayMs`, and `getRateLimitState` with `const cfg = getRateLimitConfig();` and `cfg.*`. Keep the existing `RATE_LIMIT_CONFIG` export name working by aliasing it to `RATE_LIMIT_DEFAULTS` (or export both) so nothing that imports it breaks — grep for `RATE_LIMIT_CONFIG` first and update or alias. Remove the now-unused top-level `const MIN_GAP_MS = ...` block only after all references are switched.

- [ ] **Step 4: Run config test + full worker suite.** `npm -w @event-drafter/core run build && npm -w @event-drafter/worker run test`. All green (existing rate-limit tests must still pass against the defaults).

- [ ] **Step 5: Commit.**
```bash
git add packages/core packages/worker
git commit -m "feat(worker): settings-backed rate-limit config read live"
```

---

### Task 3: Sending-cadence settings page

**Files:**
- Create: `packages/web/app/settings/sending/actions.ts`
- Create: `packages/web/app/settings/sending/page.tsx`
- Create: `packages/web/app/settings/sending/SendingForm.tsx` (client form)
- Create: `packages/web/lib/rate-limit-form.ts` (pure ms<->human conversion + warnings) + test `packages/web/lib/rate-limit-form.test.ts`
- Modify: `packages/web/app/setup/page.tsx` (add a "Sending cadence" card linking to `/settings/sending`)

- [ ] **Step 1: Pure conversion + warnings (red).** `packages/web/lib/rate-limit-form.ts` holds the ms<->human mapping and the "is this below safe" check, so it's testable without React.

```ts
export interface RateLimitForm { minGapSec: number; maxGapSec: number; batchLimit: number; cooldownMinMin: number; cooldownMaxMin: number; maxSendsPerHour: number; }
export interface RateLimitMs { minGapMs: number; maxGapMs: number; batchLimit: number; cooldownMinMs: number; cooldownMaxMs: number; maxSendsPerHour: number; }

export const FORM_DEFAULTS: RateLimitForm = { minGapSec: 10, maxGapSec: 15, batchLimit: 8, cooldownMinMin: 15, cooldownMaxMin: 30, maxSendsPerHour: 18 };

export function toMs(f: RateLimitForm): RateLimitMs {
  return {
    minGapMs: Math.round(f.minGapSec * 1000), maxGapMs: Math.round(f.maxGapSec * 1000),
    batchLimit: Math.round(f.batchLimit),
    cooldownMinMs: Math.round(f.cooldownMinMin * 60_000), cooldownMaxMs: Math.round(f.cooldownMaxMin * 60_000),
    maxSendsPerHour: Math.round(f.maxSendsPerHour),
  };
}
export function fromMs(m: RateLimitMs): RateLimitForm {
  return {
    minGapSec: m.minGapMs / 1000, maxGapSec: m.maxGapMs / 1000, batchLimit: m.batchLimit,
    cooldownMinMin: m.cooldownMinMs / 60_000, cooldownMaxMin: m.cooldownMaxMs / 60_000, maxSendsPerHour: m.maxSendsPerHour,
  };
}
/** Per-field warning string when the value is MORE aggressive than recommended-safe, else null. */
export function warnings(f: RateLimitForm): Partial<Record<keyof RateLimitForm, string>> {
  const w: Partial<Record<keyof RateLimitForm, string>> = {};
  if (f.minGapSec < 10) w.minGapSec = 'Below 10s recommended, raises ban risk';
  if (f.maxSendsPerHour > 18) w.maxSendsPerHour = 'Above 18 per hour recommended, raises ban risk';
  if (f.cooldownMinMin < 15) w.cooldownMinMin = 'Below 15 min recommended, raises ban risk';
  if (f.batchLimit > 8) w.batchLimit = 'Above 8 in a row recommended, raises ban risk';
  return w;
}
```
Test `rate-limit-form.test.ts`: `toMs(fromMs(x)) === x` round-trip for the defaults; `warnings` flags `minGapSec: 5` and `maxSendsPerHour: 40` and is empty for the defaults.

- [ ] **Step 2: Run → fail, then implement (above), run → pass.** `npm -w @event-drafter/web run test -- --run rate-limit-form`.

- [ ] **Step 3: Server actions.** `packages/web/app/settings/sending/actions.ts`:
```ts
'use server';
import { z } from 'zod';
import { getSetting, setSetting } from '@event-drafter/core/settings';
import { toMs, FORM_DEFAULTS, type RateLimitMs } from '@/lib/rate-limit-form';

// Defaults come from the local form module (same numbers as the worker's
// RATE_LIMIT_DEFAULTS), so this action has no build-order dependency on the
// worker's dist. The worker stays the source of truth for ENFORCING them.
export async function getRateLimitMs(): Promise<RateLimitMs> {
  const o = getSetting('rate_limit_config') ?? {};
  return { ...toMs(FORM_DEFAULTS), ...o };
}

const DAY = 24 * 60 * 60_000;
const schema = z.object({
  minGapMs: z.number().int().positive().max(DAY),
  maxGapMs: z.number().int().positive().max(DAY),
  batchLimit: z.number().int().min(1).max(1000),
  cooldownMinMs: z.number().int().positive().max(DAY),
  cooldownMaxMs: z.number().int().positive().max(DAY),
  maxSendsPerHour: z.number().int().min(1).max(10_000),
}).refine((v) => v.maxGapMs >= v.minGapMs, { message: 'max gap must be >= min gap', path: ['maxGapMs'] })
  .refine((v) => v.cooldownMaxMs >= v.cooldownMinMs, { message: 'max cooldown must be >= min cooldown', path: ['cooldownMaxMs'] });

export async function saveRateLimit(input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' };
  setSetting('rate_limit_config', parsed.data);
  return { ok: true };
}
```
> The defaults live in `lib/rate-limit-form.ts` (`FORM_DEFAULTS`), so this action does not import the worker package — avoids any web→worker dist build-order coupling. Keep `FORM_DEFAULTS` numerically in sync with the worker's `RATE_LIMIT_DEFAULTS` (both encode 10s/15s/8/15min/30min/18).

- [ ] **Step 4: Page + client form.** `page.tsx` (server) loads `getRateLimitMs()` → `fromMs` → passes to `<SendingForm initial={...} />`. `SendingForm.tsx` (client): six number inputs in human units, live `warnings()` rendered as amber helper text under each field (semantic warning, with a small icon), a Save button with loading + a success toast/inline confirm and an error message on failure. On save: `toMs(form)` → `saveRateLimit(ms)`; show "Saved" for ~1.2s. Use the house `.field`, `.btn-primary`, `.badge-amber`/amber helper, sentence-case labels, no em dashes. Include a short note: "The worker applies changes on the next send, no restart needed." Show the defaults as placeholder/help.

- [ ] **Step 5: Link from Setup.** In `packages/web/app/setup/page.tsx`, add a card/link to `/settings/sending` titled "Sending cadence" with a one-line description ("Tune the WhatsApp send rate limiter").

- [ ] **Step 6: Build + suite.** `npm -w @event-drafter/web run build && npm test` green; `/settings/sending` listed.

- [ ] **Step 7: Commit.**
```bash
git add packages/web
git commit -m "feat(web): sending-cadence settings page to tune the rate limiter"
```

---

## Final verification
- [ ] `npm run build` clean; `npm test` green.
- [ ] Manual smoke: open `/settings/sending`, lower the per-message gap to 5s (amber warning appears), Save (succeeds); confirm `rate_limit_config` is stored and `getRateLimitConfig()` in the worker now returns `minGapMs: 5000` (the next send paces at 5s). Restore to defaults.
- [ ] `git push origin main`.
