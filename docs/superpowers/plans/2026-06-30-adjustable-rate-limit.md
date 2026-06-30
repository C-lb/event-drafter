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

### Task 3: Sending-cadence settings page (live apply + microinteraction)

**Immediate-apply requirement:** Saving must take effect on the worker *immediately, even mid-wait*. Reading config per-send (Task 2) covers future sends, but a send already DEFERRED sits on its old `run_after`, so a shortened gap wouldn't speed it up. The save action therefore also clears `run_after` on queued (deferred) send jobs, so the poller re-evaluates them under the new limits on its very next tick (~1s). The form shows a LIVE "next send" readout (from `getRateLimitState()`) that visibly re-paces after a save — that, plus the Save confirmation, is the microinteraction.

**Files:**
- Create: `packages/web/app/settings/sending/actions.ts`
- Create: `packages/web/app/settings/sending/page.tsx`
- Create: `packages/web/app/settings/sending/SendingForm.tsx` (client form)
- Create: `packages/web/lib/rate-limit-form.ts` (pure ms<->human conversion + warnings) + test `packages/web/lib/rate-limit-form.test.ts`
- Modify: `packages/web/app/api/worker/state/route.ts` (add a `rateLimit` field from `getRateLimitState()`)
- Modify: `packages/web/lib/worker-state.ts` (add `rateLimit` to `WorkerState`, default `null`)
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

export async function saveRateLimit(input: unknown): Promise<{ ok: true; repaced: number } | { ok: false; error: string }> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' };
  setSetting('rate_limit_config', parsed.data);

  // IMMEDIATE APPLY (even mid-wait): clear run_after on deferred send jobs so the
  // poller re-evaluates them under the NEW limits on its next tick (~1s), instead
  // of sitting on a run_after computed under the OLD gap. A job that still needs to
  // wait simply re-defers with the new (e.g. shorter) delay; a job past the new gap
  // sends now. Other deferral reasons (WA-not-logged-in, selector mismatch) just
  // re-evaluate harmlessly. The per-record send claim still guards double-sends.
  const db = getDb();
  const res = db.update(jobs)
    .set({ run_after: null })
    .where(and(inArray(jobs.kind, [...SEND_KINDS]), eq(jobs.status, 'queued'), isNotNull(jobs.run_after)))
    .run();
  return { ok: true, repaced: res.changes };
}
```
Add the imports this needs at the top of the file: `import { getDb } from '@event-drafter/core/db';`, `import { jobs } from '@event-drafter/core/schema';`, `import { and, eq, inArray, isNotNull } from 'drizzle-orm';`, and a local `const SEND_KINDS = ['send_message','send_follow_up','send_response'] as const;` (do not import the worker for this).
> The defaults live in `lib/rate-limit-form.ts` (`FORM_DEFAULTS`), so this action does not import the worker package — avoids any web→worker dist build-order coupling. Keep `FORM_DEFAULTS` numerically in sync with the worker's `RATE_LIMIT_DEFAULTS` (both encode 10s/15s/8/15min/30min/18).

- [ ] **Step 3b: Surface the live rate-limit state.** In `packages/web/lib/worker-state.ts` add `rateLimit: RateLimitState | null` to `WorkerState` (import the type, or inline `{ delayMs: number|null; reason: string|null; inBatch: number; sentLastHour: number; lastSendAtMs: number|null } | null`) and default it to `null` in `summarizeWorker`. In `packages/web/app/api/worker/state/route.ts`, import `getRateLimitState` from `@event-drafter/worker/rate-limit` (it only touches the DB — no Playwright) and attach it: `return NextResponse.json({ ...state, limboCount, safetyStopped, rateLimit: getRateLimitState() }, ...)`. (If the worker import path causes a build issue, add a tiny web action `getLiveRateLimit()` that calls it and poll that instead — but prefer the route so the existing 4s poll carries it.) Rebuild worker if needed so the `./rate-limit` export resolves.

- [ ] **Step 4: Page + client form with the microinteraction.** `page.tsx` (server) loads `getRateLimitMs()` → `fromMs` → `<SendingForm initial={...} />`. `SendingForm.tsx` (client):
  - Six number inputs in human units; live `warnings()` as amber helper text under each field (semantic warning + small icon).
  - A **live "next send" readout** that polls `/api/worker/state` every ~2s and shows the `rateLimit` state: "Ready to send now" when `delayMs` is null, else "Next send in `Math.ceil(delayMs/1000)`s (`reason`)" and "`sentLastHour`/`maxPerHour` this hour". Keep a ref of the previous `delayMs`; when it CHANGES, briefly add a highlight class (e.g. an amber→transparent fade via a 600ms CSS transition or a `key` bump) so the operator SEES it re-pace.
  - **Save microinteraction:** the Save button shows a spinner while saving, then swaps its label to a check + "Applied to worker" for ~1.6s (the house copy-confirm pattern), then reverts to "Save". If `repaced > 0`, show a one-line note under the button: "Re-paced N waiting send(s) to the new limits." On error, show a red inline message. After a successful save, the live readout updates within one poll, visibly reflecting the change (this is the proof of immediate apply).
  - House classes: `.field`, `.btn-primary`, amber helper, sentence-case, no em dashes. Short note: "Changes apply immediately, no restart. Lower values send faster but raise WhatsApp ban risk."
  - Respect `prefers-reduced-motion`: skip the highlight fade, keep the text update.

- [ ] **Step 5: Link from Setup.** In `packages/web/app/setup/page.tsx`, add a card/link to `/settings/sending` titled "Sending cadence" with a one-line description ("Tune the WhatsApp send rate limiter").

- [ ] **Step 6: Build + suite.** `npm -w @event-drafter/web run build && npm test` green; `/settings/sending` listed. The worker-state unit tests must still pass with the new `rateLimit` default (`null`).

- [ ] **Step 7: Commit.**
```bash
git add packages/web
git commit -m "feat(web): sending-cadence settings page to tune the rate limiter"
```

---

## Final verification
- [ ] `npm run build` clean; `npm test` green.
- [ ] Manual smoke: open `/settings/sending`, lower the per-message gap to 5s (amber warning appears), Save → button confirms "Applied to worker" and the live "next send" readout re-paces within a poll; confirm `rate_limit_config` is stored, `getRateLimitConfig()` in the worker returns `minGapMs: 5000`, and any deferred send's `run_after` was cleared (immediate apply, even mid-wait). Restore to defaults.
- [ ] `git push origin main`.
