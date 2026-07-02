# Task 3 Report: Sending-cadence settings page

**Commit:** `cb7df80`
**Branch:** main

## Files created / modified

- `packages/web/lib/rate-limit-form.ts` — pure ms<->human conversion + `warnings()`
- `packages/web/lib/rate-limit-form.test.ts` — 9 tests (round-trip + warnings)
- `packages/web/app/settings/sending/actions.ts` — `getRateLimitMs()` + `saveRateLimit()` (clears `run_after` on queued send jobs for immediate apply)
- `packages/web/app/settings/sending/page.tsx` — server component, loads current config into form
- `packages/web/app/settings/sending/SendingForm.tsx` — client form with 6 inputs, live warnings, 2s poll readout with amber flash on re-pace, save microinteraction (spinner → check + "Applied to worker" for 1.6s), re-paced count note
- `packages/web/lib/worker-state.ts` — added `RateLimitState` interface + `rateLimit: RateLimitState | null` to `WorkerState`, default `null` in `summarizeWorker`
- `packages/web/app/api/worker/state/route.ts` — added `getRateLimitState()` from `@event-drafter/worker/rate-limit`
- `packages/web/app/setup/page.tsx` — added "Sending cadence" card linking to `/settings/sending`

## Test output

### `npm -w @event-drafter/web run test -- --run rate-limit-form`
```
Test Files  1 passed (1)
     Tests  9 passed (9)
```

### `npm -w @event-drafter/web run build`
```
✓ Compiled successfully in 14.2s
Route (app)
  ƒ /settings/sending        ← present
```

### `npm test` (full suite)
```
core:   Test Files 5 passed (5)  |  Tests 43 passed (43)
web:    Test Files 7 passed (7)  |  Tests 53 passed (53)
worker: Test Files 16 passed (16) | Tests 134 passed (134)
```

## Em-dash fix + Math.round patch (2026-06-30)

### Lines changed

| File | Line | Before | After |
|------|------|--------|-------|
| `SendingForm.tsx` | 52 | `// ignore network errors — readout just stays stale` | `// ignore network errors; readout just stays stale` |
| `rate-limit-form.ts` | 21 | `/** Mirrors RATE_LIMIT_DEFAULTS in the worker — keep in sync if either changes. */` | `/** Mirrors RATE_LIMIT_DEFAULTS in the worker: keep in sync if either changes. */` |
| `rate-limit-form.ts` | 35 | `batchLimit: f.batchLimit,` | `batchLimit: Math.round(f.batchLimit),` |
| `rate-limit-form.ts` | 38 | `maxSendsPerHour: f.maxSendsPerHour,` | `maxSendsPerHour: Math.round(f.maxSendsPerHour),` |
| `rate-limit-form.test.ts` | 4 | `describe('rate-limit-form — round-trip', ...` | `describe('rate-limit-form: round-trip', ...` |
| `rate-limit-form.test.ts` | 17 | `describe('rate-limit-form — warnings', ...` | `describe('rate-limit-form: warnings', ...` |

### Grep-clean confirmation

`grep -n "—" SendingForm.tsx rate-limit-form.ts rate-limit-form.test.ts` → exit 1 (no matches).

### Test output

```
 ✓ lib/rate-limit-form.test.ts (9 tests) 2ms
 Test Files  1 passed (1) | Tests  9 passed (9)
```

### Build

```
✓ Compiled successfully in 9.7s
✓ Generating static pages (13/13)
```

### Commit

`fix(web): drop em dashes + round rate-limit counts`

## Deviations from plan

- `res.changes` from drizzle's `.run()` requires a cast (`as { changes: number }`) since drizzle's return type does not expose `changes` directly in its TypeScript definition; the underlying better-sqlite3 `RunResult` does have it.
- The amber highlight on the live readout uses a conditional `bg-amber-50` class + inline `transition: background-color 0.6s ease` rather than a Tailwind duration class (Tailwind has no `duration-600` step; nearest are 500 and 700).
- Anti-vibecode fix applied mid-write: removed `className="label"` (no house class), replaced with `mb-1 block text-sm font-medium text-ink-1`; removed `uppercase` from the setup page eyebrow.
