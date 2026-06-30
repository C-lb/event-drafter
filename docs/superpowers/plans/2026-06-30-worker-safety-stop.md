# Worker safety stop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** A manual emergency stop that fully halts the worker (no sends, no drafting, no reply checks) within about one poll tick, reachable from every page, with a clear engaged state and a manual resume.

**Architecture:** A `worker_safety_stop` setting is the single source of truth. The worker's poll loop checks it at the top of each tick and skips ALL work while engaged (it keeps beating so the UI shows "stopped", not "offline"). The web surfaces `safetyStopped` on the always-on worker indicator with a red Stop/Resume control and a red banner. Scope decision (locked): FULL halt, not sends-only.

**Tech Stack:** Node worker poll loop, Drizzle/SQLite settings, Next.js server actions, the existing `WorkerStatus` indicator.

## Global Constraints

- Setting: `worker_safety_stop: { engaged: boolean; ts: number }`. Engaged === `getSetting('worker_safety_stop')?.engaged === true`.
- Full halt: while engaged the worker runs NO jobs of any kind. It still calls `beat()` so the heartbeat stays fresh and the indicator distinguishes "stopped" from "offline".
- The halt check is at the top of `runForever`'s loop, after `beat()`, before `maybeHandleRestart()` and `tick()`. A send already mid-WhatsApp-action in the current tick may finish (cannot be interrupted), but no NEW tick runs while engaged. This is the intended guarantee.
- Indicator precedence: when `safetyStopped` is true the pill shows red "safety stop on" regardless of busy/idle, and a red full-width banner shows on every page with a Resume button. Red = danger semantic.
- House anti-vibecode UI rules: one accent, semantic red for the stop only, sentence-case, no em dashes, every button has loading/disabled state.
- All worker-state plumbing mirrors the existing `limboCount` pattern (default in `summarizeWorker`, real value attached in the route).
- Core consumed from `dist/`; rebuild core after editing it (`npm run build`). Commit per task; push at the end.

---

### Task 1: Halt mechanism + state plumbing

**Files:**
- Modify: `packages/core/src/schema/settings.ts` (add `'worker_safety_stop'` to `SETTING_KEYS`)
- Modify: `packages/core/src/settings.ts` (add `worker_safety_stop: { engaged: boolean; ts: number }` to the `SettingTypes` interface)
- Modify: `packages/worker/src/poller.ts` (halt check in `runForever`)
- Modify: `packages/web/lib/worker-state.ts` (add `safetyStopped: boolean` to `WorkerState`, default `false` in `summarizeWorker`; `pillSummary` returns red stop text first)
- Modify: `packages/web/lib/worker-state.test.ts` (pillSummary precedence + default)
- Modify: `packages/web/app/api/worker/state/route.ts` (attach `safetyStopped`)
- Create: `packages/web/app/status/safety-actions.ts` (`engageSafetyStop`, `releaseSafetyStop`)
- Test: `packages/worker/test/safety-stop.test.ts`

**Interfaces:**
- Produces: `engageSafetyStop(): Promise<void>`, `releaseSafetyStop(): Promise<void>`; `WorkerState.safetyStopped: boolean`.

- [ ] **Step 1: Worker test (red).** Create `packages/worker/test/safety-stop.test.ts` using the temp-DB harness from `packages/worker/test/restart.test.ts`. Add a test that a queued job is NOT claimed while the safety stop is engaged. Since `runForever` loops forever, test the guard via a small extracted predicate instead: add (in poller.ts) `export function isSafetyStopped(): boolean { return getSetting('worker_safety_stop')?.engaged === true; }` and test it returns true after `setSetting('worker_safety_stop', { engaged: true, ts: Date.now() })` and false otherwise / when unset. Also assert `tick()` still drains a queued `noop` job when NOT stopped (sanity) — but do NOT call `runForever`.

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@event-drafter/core/migrate';
import { closeDb } from '@event-drafter/core/db';
import { setSetting } from '@event-drafter/core/settings';
import { isSafetyStopped } from '../src/poller.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'ed-safety-')); process.env.ED_DB_PATH = join(tmp, 'app.db'); runMigrations(); });
afterEach(() => { closeDb(); rmSync(tmp, { recursive: true, force: true }); });

describe('isSafetyStopped', () => {
  it('is false when unset', () => { expect(isSafetyStopped()).toBe(false); });
  it('is true once engaged', () => { setSetting('worker_safety_stop', { engaged: true, ts: Date.now() }); expect(isSafetyStopped()).toBe(true); });
  it('is false once released', () => { setSetting('worker_safety_stop', { engaged: false, ts: Date.now() }); expect(isSafetyStopped()).toBe(false); });
});
```

- [ ] **Step 2: Run it, see it fail** — `npm -w @event-drafter/worker run test -- --run safety-stop` → FAIL (`isSafetyStopped` not exported, and the setting key/type missing).

- [ ] **Step 3: Register the setting.** In `packages/core/src/schema/settings.ts`, add `'worker_safety_stop'` to the `SETTING_KEYS` array (match the existing literal-array style). In `packages/core/src/settings.ts`, add to the `SettingTypes` interface: `worker_safety_stop: { engaged: boolean; ts: number };`.

- [ ] **Step 4: Halt the loop.** In `packages/worker/src/poller.ts`, add the predicate and the guard:

```ts
import { getSetting } from '@event-drafter/core/settings';
// ...
/** True while the operator has engaged the emergency safety stop. */
export function isSafetyStopped(): boolean {
  return getSetting('worker_safety_stop')?.engaged === true;
}
```

Then in `runForever`, change the loop body so the stop halts everything but keeps the heartbeat:

```ts
while (true) {
  beat();
  if (isSafetyStopped()) {
    await new Promise((r) => setTimeout(r, intervalMs));
    continue;
  }
  const restarted = maybeHandleRestart();
  const did = await tick();
  if (did === 0 && !restarted) await new Promise((r) => setTimeout(r, intervalMs));
}
```

- [ ] **Step 5: Rebuild core (so worker/web see the new setting type) and run the worker test.**
Run: `npm -w @event-drafter/core run build && npm -w @event-drafter/worker run test -- --run safety-stop` → PASS (3 tests).

- [ ] **Step 6: Worker-state field + pill.** In `packages/web/lib/worker-state.ts`: add `safetyStopped: boolean;` to `WorkerState`; add `safetyStopped: false,` to the object `summarizeWorker` returns. In `pillSummary`, make it the first branch:

```ts
export function pillSummary(state: WorkerState): { tone: PillTone; text: string } {
  if (state.safetyStopped) return { tone: 'down', text: 'safety stop on' };
  if (!state.connected) return { tone: 'down', text: 'worker offline' };
  // ...unchanged...
}
```

Add to `packages/web/lib/worker-state.test.ts` (inside the `pillSummary` describe):

```ts
  it('shows safety stop first, even when connected and idle', () => {
    expect(live({ safetyStopped: true })).toEqual({ tone: 'down', text: 'safety stop on' });
  });
```

- [ ] **Step 7: Run worker-state tests** — `npm -w @event-drafter/web run test -- --run worker-state` → PASS.

- [ ] **Step 8: Route + actions.** In `packages/web/app/api/worker/state/route.ts`, read the flag and attach it (mirror `limboCount`):

```ts
const safetyStopped = getSetting('worker_safety_stop')?.engaged === true;
return NextResponse.json({ ...state, limboCount, safetyStopped }, { headers: { 'Cache-Control': 'no-store' } });
```

Create `packages/web/app/status/safety-actions.ts`:

```ts
'use server';
import { setSetting } from '@event-drafter/core/settings';

export async function engageSafetyStop() {
  setSetting('worker_safety_stop', { engaged: true, ts: Date.now() });
}
export async function releaseSafetyStop() {
  setSetting('worker_safety_stop', { engaged: false, ts: Date.now() });
}
```

- [ ] **Step 9: Build + full suite.** `npm -w @event-drafter/web run build && npm test` → green.

- [ ] **Step 10: Commit.**

```bash
git add packages/core packages/worker packages/web
git commit -m "feat(worker): emergency safety stop halts the worker (mechanism + state)"
```

---

### Task 2: Stop / Resume control on the worker indicator

**Files:**
- Modify: `packages/web/app/components/WorkerStatus.tsx` (a red Stop button next to the pill; a red full-width safety-stop banner with Resume; both call the Task 1 actions)

**Interfaces:**
- Consumes: `engageSafetyStop`, `releaseSafetyStop` from `@/app/status/safety-actions`; `state.safetyStopped`.

- [ ] **Step 1: Add the control.** In `WorkerStatus.tsx`:
  - Import the actions and `useTransition`/local busy state (the component already has `useState`).
  - Right after the limbo chip (before `{open && <Popover/>}`), render a stop/resume button:

```tsx
{state.safetyStopped ? (
  <button
    type="button"
    onClick={() => { setStopBusy(true); startStop(async () => { await releaseSafetyStop(); setStopBusy(false); }); }}
    disabled={stopBusy}
    className="btn btn-sm ml-2"
  >
    {stopBusy ? <span className="spinner" /> : 'Resume worker'}
  </button>
) : (
  <button
    type="button"
    onClick={() => { setStopBusy(true); startStop(async () => { await engageSafetyStop(); setStopBusy(false); }); }}
    disabled={stopBusy}
    className="btn-danger btn-sm ml-2"
  >
    {stopBusy ? <span className="spinner" /> : 'Safety stop'}
  </button>
)}
```

Add the supporting state near the other hooks: `const [stopBusy, setStopBusy] = useState(false); const [, startStop] = useTransition();` (import `useTransition`). After either action resolves, the 4s poll refreshes `state`; no manual refetch needed, but you MAY call an immediate re-poll if a helper exists — not required.

  - Add a red full-width banner that shows whenever `state.safetyStopped` (portal into the same `worker-banner-slot`, like `OfflineBanner`). Render it in addition to the offline banner logic:

```tsx
{mounted && state.safetyStopped &&
  createPortal(<SafetyBanner onResume={() => { setStopBusy(true); startStop(async () => { await releaseSafetyStop(); setStopBusy(false); }); }} busy={stopBusy} />, getBannerSlot())}
```

  And define `SafetyBanner` near `OfflineBanner`:

```tsx
function SafetyBanner({ onResume, busy }: { onResume: () => void; busy: boolean }) {
  return (
    <div className="border-b border-red-600/25 bg-red-50 text-red-800">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-6 py-2.5 text-sm">
        <span className="inline-flex items-center gap-2 font-semibold text-red-900">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 flex-none" aria-hidden>
            <circle cx="12" cy="12" r="9" /><path d="M9 9h6v6H9z" />
          </svg>
          Safety stop engaged
        </span>
        <span className="text-red-700">The worker is halted. No messages will be sent until you resume.</span>
        <button type="button" onClick={onResume} disabled={busy} className="btn btn-sm ml-auto border-red-600/30 bg-white/70">
          {busy ? <span className="spinner" /> : 'Resume worker'}
        </button>
      </div>
    </div>
  );
}
```

> If both the offline banner and the safety banner could mount into the single `worker-banner-slot`, render only ONE: when `safetyStopped`, show the safety banner and skip the offline banner (guard the offline `createPortal` with `&& !state.safetyStopped`). A safety stop while the worker still beats means `connected` is true anyway, so in practice only one applies, but add the guard to be safe.

- [ ] **Step 2: Build.** `npm -w @event-drafter/web run build` → success, `/` and `/status` listed.

- [ ] **Step 3: Commit.**

```bash
git add packages/web/app/components/WorkerStatus.tsx
git commit -m "feat(web): safety stop / resume control on the worker indicator"
```

---

## Final verification
- [ ] `npm run build` clean; `npm test` green.
- [ ] Manual smoke: engage safety stop from the header → pill turns red "safety stop on", red banner appears on every page; the worker (if running) stops claiming jobs within ~1s; Resume clears it and the queue drains.
- [ ] `git push origin main`.
