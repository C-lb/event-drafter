# Stranded-send recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the operator a per-message recovery flow for WhatsApp sends that were caught mid-flight when the worker was cut off, without ever auto-resending an ambiguous message.

**Architecture:** A pure selector (`lib/limbo.ts`) decides which records are "in limbo"; a server-only read module (`lib/limbo-read.ts`) fetches the candidate records and the live in-flight send and feeds the selector; server actions (`app/status/limbo-actions.ts`) perform the two recovery mutations plus a bulk resend; a `/status` section renders the list; the worker status indicator shows a count. Reuses the existing single-send claim path — a resend just re-enters the normal `approved → claim → send` flow.

**Tech Stack:** Next.js App Router (server components + server actions), Drizzle ORM over better-sqlite3, Vitest, Tailwind with the repo's anti-vibecode component classes.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-30-stranded-send-recovery-design.md`.
- Three send record types, identical status vocabulary (`pending|drafted|approved|sending|prefilled|sent|skipped|failed`):
  - invite → table `invites`, status col `status`, send kind `send_message`, payload key `invite_id`, timestamps `approved_at`/`prefilled_at`/`sent_at`.
  - follow-up → table `follow_ups`, status col `status`, send kind `send_follow_up`, payload key `follow_up_id`, timestamps `approved_at`/`prefilled_at`/`sent_at`.
  - reply → table `replies`, status col `response_status`, send kind `send_response`, payload key `reply_id`, timestamps `response_approved_at`/`response_prefilled_at`/`response_sent_at`.
- Flag rule: `sending` always; `prefilled` only when `getSetting('auto_send_enabled') === true`. Exclude the record the worker is actively sending **only when the worker is connected** (heartbeat fresher than `STALE_MS` from `lib/worker-state.ts`); when offline, the stuck record IS the victim and must show.
- Recovery never sends until the operator clicks. No bulk action on the `sending` group; bulk only on `prefilled`.
- Reuse existing send job kinds; do not add new ones.
- UI follows the anti-vibecode house rules (badges/cards/btn tiers, one accent, sentence-case eyebrows, no em dashes, every action has loading + result feedback).
- Core is consumed from `dist/`; no core changes are needed in this plan. All changes are in `packages/web`. Run web tests with `npm -w @event-drafter/web run test`.
- Commit after each task. Push to `main` at the end (repo default; no PR).

---

### Task 1: Pure limbo selector

**Files:**
- Create: `packages/web/lib/limbo.ts`
- Test: `packages/web/lib/limbo.test.ts`

**Interfaces:**
- Produces:
  - `type LimboType = 'invite' | 'follow_up' | 'reply'`
  - `type LimboState = 'sending' | 'prefilled'`
  - `interface LimboRecord { type: LimboType; id: number; state: LimboState; name: string; eventId: number | null; eventName: string | null }`
  - `interface LimboInput { records: LimboRecord[]; autoSend: boolean; activeSend: { type: LimboType; id: number } | null }`
  - `interface LimboList { records: LimboRecord[]; count: number; prefilledCount: number }`
  - `function selectLimbo(input: LimboInput): LimboList`

- [ ] **Step 1: Write the failing test**

```ts
// packages/web/lib/limbo.test.ts
import { describe, it, expect } from 'vitest';
import { selectLimbo, type LimboRecord } from './limbo';

const rec = (p: Partial<LimboRecord> & Pick<LimboRecord, 'type' | 'id' | 'state'>): LimboRecord => ({
  name: `name-${p.id}`,
  eventId: 1,
  eventName: 'Gala',
  ...p,
});

describe('selectLimbo', () => {
  it('always flags sending, regardless of auto-send', () => {
    const out = selectLimbo({
      records: [rec({ type: 'invite', id: 1, state: 'sending' })],
      autoSend: false,
      activeSend: null,
    });
    expect(out.count).toBe(1);
    expect(out.prefilledCount).toBe(0);
  });

  it('flags prefilled only when auto-send is on', () => {
    const records = [rec({ type: 'invite', id: 2, state: 'prefilled' })];
    expect(selectLimbo({ records, autoSend: false, activeSend: null }).count).toBe(0);
    const on = selectLimbo({ records, autoSend: true, activeSend: null });
    expect(on.count).toBe(1);
    expect(on.prefilledCount).toBe(1);
  });

  it('excludes the record being actively sent right now', () => {
    const out = selectLimbo({
      records: [
        rec({ type: 'invite', id: 1, state: 'sending' }),
        rec({ type: 'reply', id: 1, state: 'sending' }),
      ],
      autoSend: false,
      activeSend: { type: 'invite', id: 1 },
    });
    expect(out.records.map((r) => `${r.type}:${r.id}`)).toEqual(['reply:1']);
  });

  it('orders sending before prefilled', () => {
    const out = selectLimbo({
      records: [
        rec({ type: 'invite', id: 9, state: 'prefilled' }),
        rec({ type: 'invite', id: 8, state: 'sending' }),
      ],
      autoSend: true,
      activeSend: null,
    });
    expect(out.records.map((r) => r.state)).toEqual(['sending', 'prefilled']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @event-drafter/web run test -- --run limbo`
Expected: FAIL (cannot find module `./limbo`).

- [ ] **Step 3: Write the implementation**

```ts
// packages/web/lib/limbo.ts
// Decides which mid-send records need an operator decision after a crash.
// Pure: all DB I/O lives in lib/limbo-read.ts.

export type LimboType = 'invite' | 'follow_up' | 'reply';
export type LimboState = 'sending' | 'prefilled';

export interface LimboRecord {
  type: LimboType;
  /** record id: invite_id / follow_up_id / reply_id */
  id: number;
  state: LimboState;
  name: string;
  eventId: number | null;
  eventName: string | null;
}

export interface LimboInput {
  /** candidates already narrowed to status in ('sending','prefilled') */
  records: LimboRecord[];
  autoSend: boolean;
  /** the record the worker is sending right now (exclude), or null */
  activeSend: { type: LimboType; id: number } | null;
}

export interface LimboList {
  records: LimboRecord[];
  count: number;
  prefilledCount: number;
}

export function selectLimbo(input: LimboInput): LimboList {
  const { records, autoSend, activeSend } = input;
  const flagged = records.filter((r) => {
    if (activeSend && r.type === activeSend.type && r.id === activeSend.id) return false;
    if (r.state === 'sending') return true;
    return autoSend; // prefilled: only when auto-send is on
  });
  flagged.sort((a, b) => {
    if (a.state !== b.state) return a.state === 'sending' ? -1 : 1;
    return (a.eventName ?? '').localeCompare(b.eventName ?? '') || a.name.localeCompare(b.name);
  });
  return {
    records: flagged,
    count: flagged.length,
    prefilledCount: flagged.filter((r) => r.state === 'prefilled').length,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w @event-drafter/web run test -- --run limbo`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/limbo.ts packages/web/lib/limbo.test.ts
git commit -m "feat(web): pure limbo selector for stranded sends"
```

---

### Task 2: DB read module (candidates + active send + connected gate)

**Files:**
- Create: `packages/web/lib/limbo-read.ts`
- Test: `packages/web/lib/limbo-read.test.ts`

**Interfaces:**
- Consumes: `selectLimbo`, `LimboType`, `LimboRecord`, `LimboList` from `./limbo`; `STALE_MS` from `./worker-state`; `getDb` from `@/lib/db`; `getSetting` from `@event-drafter/core/settings`; schema from `@event-drafter/core/schema`.
- Produces: `function readLimbo(now?: number): LimboList`

- [ ] **Step 1: Write the failing test** (temp-DB harness; mirrors `packages/worker/test/restart.test.ts`)

```ts
// packages/web/lib/limbo-read.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@event-drafter/core/migrate';
import { closeDb, getDb } from '@event-drafter/core/db';
import { events, contacts, invites } from '@event-drafter/core/schema';
import { setSetting } from '@event-drafter/core/settings';
import { readLimbo } from './limbo-read';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'ed-limbo-test-'));
  process.env.ED_DB_PATH = join(tmp, 'app.db');
  runMigrations();
});
afterEach(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

function seedInvite(status: string): number {
  const db = getDb();
  const ev = db.insert(events).values({ name: 'Gala' }).returning().get();
  const c = db.insert(contacts).values({ first_name: 'Ann', phone_e164: '+1' }).returning().get();
  const inv = db
    .insert(invites)
    .values({ event_id: ev.id, contact_id: c.id, status: status as never, draft_text: 'hi' })
    .returning()
    .get();
  return inv.id;
}

describe('readLimbo', () => {
  it('flags a sending invite even with auto-send off', () => {
    seedInvite('sending');
    setSetting('auto_send_enabled', false);
    const out = readLimbo();
    expect(out.count).toBe(1);
    expect(out.records[0].name).toBe('Ann ');
  });

  it('flags a prefilled invite only when auto-send is on', () => {
    seedInvite('prefilled');
    setSetting('auto_send_enabled', false);
    expect(readLimbo().count).toBe(0);
    setSetting('auto_send_enabled', true);
    expect(readLimbo().count).toBe(1);
  });

  it('ignores approved/sent invites', () => {
    seedInvite('approved');
    seedInvite('sent');
    expect(readLimbo().count).toBe(0);
  });
});
```

> Note on the expected name `'Ann '`: the list query builds the display name as `first_name || ' ' || COALESCE(last_name,'')` to match the existing pattern in `app/follow-ups/actions.ts`. Keep that exact expression so the test holds.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @event-drafter/web run test -- --run limbo-read`
Expected: FAIL (cannot find module `./limbo-read`).

- [ ] **Step 3: Write the implementation**

```ts
// packages/web/lib/limbo-read.ts
import 'server-only';
import { getDb } from '@/lib/db';
import { getSetting } from '@event-drafter/core/settings';
import { invites, follow_ups, replies, contacts, events, jobs } from '@event-drafter/core/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { STALE_MS } from './worker-state';
import { selectLimbo, type LimboList, type LimboRecord, type LimboType } from './limbo';

const NAME = sql<string>`${contacts.first_name} || ' ' || COALESCE(${contacts.last_name}, '')`;
const MID = ['sending', 'prefilled'] as const;

function inviteCandidates(): LimboRecord[] {
  return getDb()
    .select({ id: invites.id, status: invites.status, name: NAME, eventId: events.id, eventName: events.name })
    .from(invites)
    .innerJoin(contacts, eq(invites.contact_id, contacts.id))
    .innerJoin(events, eq(invites.event_id, events.id))
    .where(inArray(invites.status, [...MID]))
    .all()
    .map((r) => ({ type: 'invite' as LimboType, id: r.id, state: r.status as 'sending' | 'prefilled', name: r.name, eventId: r.eventId, eventName: r.eventName }));
}

function followUpCandidates(): LimboRecord[] {
  return getDb()
    .select({ id: follow_ups.id, status: follow_ups.status, name: NAME, eventId: events.id, eventName: events.name })
    .from(follow_ups)
    .innerJoin(invites, eq(follow_ups.invite_id, invites.id))
    .innerJoin(contacts, eq(invites.contact_id, contacts.id))
    .innerJoin(events, eq(invites.event_id, events.id))
    .where(inArray(follow_ups.status, [...MID]))
    .all()
    .map((r) => ({ type: 'follow_up' as LimboType, id: r.id, state: r.status as 'sending' | 'prefilled', name: r.name, eventId: r.eventId, eventName: r.eventName }));
}

function replyCandidates(): LimboRecord[] {
  return getDb()
    .select({ id: replies.id, status: replies.response_status, name: NAME, eventId: events.id, eventName: events.name })
    .from(replies)
    .innerJoin(invites, eq(replies.invite_id, invites.id))
    .innerJoin(contacts, eq(invites.contact_id, contacts.id))
    .innerJoin(events, eq(invites.event_id, events.id))
    .where(inArray(replies.response_status, [...MID]))
    .all()
    .map((r) => ({ type: 'reply' as LimboType, id: r.id, state: r.status as 'sending' | 'prefilled', name: r.name, eventId: r.eventId, eventName: r.eventName }));
}

/** The record the running send job targets, mapped to {type,id}. Null if none. */
function runningSendTarget(): { type: LimboType; id: number } | null {
  const job = getDb()
    .select({ kind: jobs.kind, payload: jobs.payload })
    .from(jobs)
    .where(and(eq(jobs.status, 'running'), inArray(jobs.kind, ['send_message', 'send_follow_up', 'send_response'])))
    .limit(1)
    .get();
  if (!job) return null;
  const p = (job.payload ?? {}) as Record<string, number>;
  if (job.kind === 'send_message' && p.invite_id) return { type: 'invite', id: p.invite_id };
  if (job.kind === 'send_follow_up' && p.follow_up_id) return { type: 'follow_up', id: p.follow_up_id };
  if (job.kind === 'send_response' && p.reply_id) return { type: 'reply', id: p.reply_id };
  return null;
}

export function readLimbo(now: number = Date.now()): LimboList {
  const autoSend = getSetting('auto_send_enabled') === true;
  const hb = getSetting('worker_heartbeat');
  const connected = !!hb && now - hb.ts < STALE_MS;
  const activeSend = connected ? runningSendTarget() : null;
  const records = [...inviteCandidates(), ...followUpCandidates(), ...replyCandidates()];
  return selectLimbo({ records, autoSend, activeSend });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w @event-drafter/web run test -- --run limbo-read`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/limbo-read.ts packages/web/lib/limbo-read.test.ts
git commit -m "feat(web): read stranded-send candidates from the db"
```

---

### Task 3: Recovery server actions

**Files:**
- Create: `packages/web/app/status/limbo-actions.ts`
- Test: `packages/web/app/status/limbo-actions.test.ts`

**Interfaces:**
- Consumes: `readLimbo` from `@/lib/limbo-read`; `LimboType` from `@/lib/limbo`; schema + `getDb`.
- Produces (all `'use server'`):
  - `listLimbo(): Promise<LimboList>`
  - `recoverMarkSent(input: { type: LimboType; id: number }): Promise<void>`
  - `recoverResend(input: { type: LimboType; id: number }): Promise<void>`
  - `recoverResendAllPrefilled(): Promise<{ resent: number }>`

- [ ] **Step 1: Write the failing test**

```ts
// packages/web/app/status/limbo-actions.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@event-drafter/core/migrate';
import { closeDb, getDb } from '@event-drafter/core/db';
import { events, contacts, invites, jobs } from '@event-drafter/core/schema';
import { eq } from 'drizzle-orm';
import { recoverMarkSent, recoverResend, recoverResendAllPrefilled } from './limbo-actions';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'ed-limboact-test-'));
  process.env.ED_DB_PATH = join(tmp, 'app.db');
  runMigrations();
});
afterEach(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

function seedInvite(status: string): number {
  const db = getDb();
  const ev = db.insert(events).values({ name: 'Gala' }).returning().get();
  const c = db.insert(contacts).values({ first_name: 'Ann', phone_e164: '+1' }).returning().get();
  const inv = db.insert(invites).values({ event_id: ev.id, contact_id: c.id, status: status as never, draft_text: 'hi' }).returning().get();
  return inv.id;
}
function stuckJob(invite_id: number) {
  getDb().insert(jobs).values({ kind: 'send_message', payload: { invite_id }, status: 'running', started_at: new Date() }).run();
}

describe('recovery actions', () => {
  it('mark-sent sets the invite sent and fails the orphan job', async () => {
    const id = seedInvite('sending');
    stuckJob(id);
    await recoverMarkSent({ type: 'invite', id });
    const inv = getDb().select().from(invites).where(eq(invites.id, id)).get();
    expect(inv?.status).toBe('sent');
    const job = getDb().select().from(jobs).where(eq(jobs.status, 'failed')).get();
    expect(job?.last_error).toContain('superseded by operator recovery');
  });

  it('resend re-approves, enqueues a fresh send, fails the orphan job', async () => {
    const id = seedInvite('sending');
    stuckJob(id);
    await recoverResend({ type: 'invite', id });
    const inv = getDb().select().from(invites).where(eq(invites.id, id)).get();
    expect(inv?.status).toBe('approved');
    expect(inv?.prefilled_at).toBeNull();
    const queued = getDb().select().from(jobs).where(eq(jobs.status, 'queued')).all();
    expect(queued.some((j) => j.kind === 'send_message')).toBe(true);
    const failed = getDb().select().from(jobs).where(eq(jobs.status, 'failed')).get();
    expect(failed).toBeTruthy();
  });

  it('bulk resend re-approves every prefilled record', async () => {
    const a = seedInvite('prefilled');
    const b = seedInvite('prefilled');
    seedInvite('sending'); // not prefilled -> untouched by bulk
    const { resent } = await recoverResendAllPrefilled();
    expect(resent).toBe(2);
    const rows = getDb().select().from(invites).all();
    expect(rows.filter((r) => r.id === a || r.id === b).every((r) => r.status === 'approved')).toBe(true);
  });
});
```

> The bulk test relies on `auto_send_enabled` being on so prefilled is flagged. `recoverResendAllPrefilled` sets no setting; seed it in the test if needed: add `setSetting('auto_send_enabled', true)` (import from `@event-drafter/core/settings`) at the top of that test before calling. Add that line.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @event-drafter/web run test -- --run limbo-actions`
Expected: FAIL (cannot find module `./limbo-actions`).

- [ ] **Step 3: Write the implementation**

```ts
// packages/web/app/status/limbo-actions.ts
'use server';

import { getDb } from '@/lib/db';
import { invites, follow_ups, replies, jobs } from '@event-drafter/core/schema';
import { and, eq, sql } from 'drizzle-orm';
import { readLimbo } from '@/lib/limbo-read';
import type { LimboType } from '@/lib/limbo';

export async function listLimbo() {
  return readLimbo();
}

interface Desc {
  sendKind: 'send_message' | 'send_follow_up' | 'send_response';
  payloadKey: 'invite_id' | 'follow_up_id' | 'reply_id';
  markSent: (db: ReturnType<typeof getDb>, id: number) => void;
  reApprove: (db: ReturnType<typeof getDb>, id: number) => void;
}

const DESC: Record<LimboType, Desc> = {
  invite: {
    sendKind: 'send_message',
    payloadKey: 'invite_id',
    markSent: (db, id) => db.update(invites).set({ status: 'sent', sent_at: new Date() }).where(eq(invites.id, id)).run(),
    reApprove: (db, id) => db.update(invites).set({ status: 'approved', approved_at: new Date(), prefilled_at: null, sent_at: null }).where(eq(invites.id, id)).run(),
  },
  follow_up: {
    sendKind: 'send_follow_up',
    payloadKey: 'follow_up_id',
    markSent: (db, id) => db.update(follow_ups).set({ status: 'sent', sent_at: new Date() }).where(eq(follow_ups.id, id)).run(),
    reApprove: (db, id) => db.update(follow_ups).set({ status: 'approved', approved_at: new Date(), prefilled_at: null, sent_at: null }).where(eq(follow_ups.id, id)).run(),
  },
  reply: {
    sendKind: 'send_response',
    payloadKey: 'reply_id',
    markSent: (db, id) => db.update(replies).set({ response_status: 'sent', response_sent_at: new Date() }).where(eq(replies.id, id)).run(),
    reApprove: (db, id) => db.update(replies).set({ response_status: 'approved', response_approved_at: new Date(), response_prefilled_at: null, response_sent_at: null }).where(eq(replies.id, id)).run(),
  },
};

/** Fail the stuck running send job for this record so it stops reading as in-flight. */
function failOrphanJob(db: ReturnType<typeof getDb>, d: Desc, id: number): void {
  db.update(jobs)
    .set({ status: 'failed', finished_at: new Date(), last_error: 'superseded by operator recovery' })
    .where(and(eq(jobs.status, 'running'), eq(jobs.kind, d.sendKind), sql`json_extract(${jobs.payload}, ${'$.' + d.payloadKey}) = ${id}`))
    .run();
}

export async function recoverMarkSent(input: { type: LimboType; id: number }) {
  const d = DESC[input.type];
  const db = getDb();
  db.transaction((tx) => {
    d.markSent(tx, input.id);
    failOrphanJob(tx, d, input.id);
  });
}

export async function recoverResend(input: { type: LimboType; id: number }) {
  const d = DESC[input.type];
  const db = getDb();
  db.transaction((tx) => {
    d.reApprove(tx, input.id);
    failOrphanJob(tx, d, input.id);
    tx.insert(jobs).values({ kind: d.sendKind, payload: { [d.payloadKey]: input.id } }).run();
  });
}

export async function recoverResendAllPrefilled(): Promise<{ resent: number }> {
  const prefilled = readLimbo().records.filter((r) => r.state === 'prefilled');
  for (const r of prefilled) await recoverResend({ type: r.type, id: r.id });
  return { resent: prefilled.length };
}
```

> Drizzle note: `tx` inside `db.transaction` has the same query API as `db`, so passing it where `Desc` expects `ReturnType<typeof getDb>` typechecks. If the transaction param type complains, change the `markSent`/`reApprove`/`failOrphanJob` parameter types to `any` for the db handle — the runtime behavior is unchanged. Prefer the typed form first.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w @event-drafter/web run test -- --run limbo-actions`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/app/status/limbo-actions.ts packages/web/app/status/limbo-actions.test.ts
git commit -m "feat(web): recovery actions for stranded sends (mark-sent, resend, bulk)"
```

---

### Task 4: Limbo section on the status page

**Files:**
- Create: `packages/web/app/status/MessagesInLimbo.tsx`
- Modify: `packages/web/app/status/page.tsx` (import + render the section near the top, above "Worker heartbeat" cards)

**Interfaces:**
- Consumes: `listLimbo`, `recoverMarkSent`, `recoverResend`, `recoverResendAllPrefilled` from `./limbo-actions`; `LimboRecord` from `@/lib/limbo`.

- [ ] **Step 1: Create the client section**

```tsx
// packages/web/app/status/MessagesInLimbo.tsx
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { LimboRecord } from '@/lib/limbo';
import { recoverMarkSent, recoverResend, recoverResendAllPrefilled } from './limbo-actions';

export function MessagesInLimbo({ records, prefilledCount }: { records: LimboRecord[]; prefilledCount: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();

  if (records.length === 0) return null;

  const run = (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    start(async () => {
      try {
        await fn();
        router.refresh();
      } finally {
        setBusy(null);
      }
    });
  };

  return (
    <div className="card border-amber-600/25 bg-amber-50 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-amber-900">Messages in limbo</h3>
          <p className="text-xs text-amber-800">
            The worker was cut off mid-send on these. They will not resend on their own. Choose what happened.
          </p>
        </div>
        {prefilledCount > 0 && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => run('bulk', () => recoverResendAllPrefilled())}
            className={`btn btn-sm ${busy === 'bulk' ? 'is-loading' : ''}`}
          >
            {busy === 'bulk' ? <span className="spinner" /> : `Resend all prefilled (${prefilledCount})`}
          </button>
        )}
      </div>

      <ul className="mt-3 space-y-2">
        {records.map((r) => {
          const key = `${r.type}:${r.id}`;
          return (
            <li key={key} className="flex flex-wrap items-center justify-between gap-2 rounded-sm bg-white/60 px-3 py-2 text-sm">
              <span className="flex items-center gap-2">
                <span className={`badge ${r.state === 'sending' ? 'badge-amber' : 'badge-neutral'}`}>
                  {r.state === 'sending' ? 'mid-send' : 'prefilled'}
                </span>
                <strong className="text-ink">{r.name.trim()}</strong>
                {r.eventName && <span className="text-ink-3">{r.eventName}</span>}
              </span>
              <span className="flex gap-2">
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => run(`sent:${key}`, () => recoverMarkSent({ type: r.type, id: r.id }))}
                  className={`btn btn-sm ${busy === `sent:${key}` ? 'is-loading' : ''}`}
                >
                  {busy === `sent:${key}` ? <span className="spinner" /> : 'It was sent'}
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => run(`resend:${key}`, () => recoverResend({ type: r.type, id: r.id }))}
                  className={`btn-primary btn-sm ${busy === `resend:${key}` ? 'is-loading' : ''}`}
                >
                  {busy === `resend:${key}` ? <span className="spinner" /> : 'Resend'}
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Render it on the status page**

In `packages/web/app/status/page.tsx`, add near the top imports:

```tsx
import { listLimbo } from './limbo-actions';
import { MessagesInLimbo } from './MessagesInLimbo';
```

Inside `StatusPage`, after `const db = getDb();` add:

```tsx
const limbo = await listLimbo();
```

Then in the returned JSX, immediately after the opening `<section ...>` and the `<AutoRefresh ... />`, render:

```tsx
<MessagesInLimbo records={limbo.records} prefilledCount={limbo.prefilledCount} />
```

- [ ] **Step 3: Verify the build typechecks**

Run: `npm -w @event-drafter/web run build`
Expected: build succeeds; `/status` still listed.

- [ ] **Step 4: Commit**

```bash
git add packages/web/app/status/MessagesInLimbo.tsx packages/web/app/status/page.tsx
git commit -m "feat(web): messages-in-limbo recovery section on status page"
```

---

### Task 5: Surface the limbo count on the worker indicator

**Files:**
- Modify: `packages/web/lib/worker-state.ts` (add `limboCount: number` to `WorkerState`, default 0 in `summarizeWorker`)
- Modify: `packages/web/app/api/worker/state/route.ts` (set `limboCount` from `readLimbo().count`)
- Modify: `packages/web/app/components/WorkerStatus.tsx` (amber "N need a decision" line in the offline banner and a small amber chip on the pill row when `limboCount > 0`)
- Modify: `packages/web/lib/worker-state.test.ts` (assert default `limboCount === 0`)

**Interfaces:**
- Consumes: `readLimbo` from `@/lib/limbo-read`.
- Produces: `WorkerState.limboCount: number`.

- [ ] **Step 1: Extend the type + summarizer (and its test)**

In `lib/worker-state.ts`, add to the `WorkerState` interface:

```ts
  /** Count of messages caught mid-send that need an operator decision. */
  limboCount: number;
```

In `summarizeWorker`'s returned object add:

```ts
    limboCount: 0,
```

In `lib/worker-state.test.ts`, inside the existing "liveness" describe, add:

```ts
  it('defaults limboCount to 0', () => {
    const s = summarizeWorker({ ...base, heartbeat: { ts: NOW } });
    expect(s.limboCount).toBe(0);
  });
```

- [ ] **Step 2: Run the unit tests**

Run: `npm -w @event-drafter/web run test -- --run worker-state`
Expected: PASS (12 tests).

- [ ] **Step 3: Set limboCount in the route**

In `packages/web/app/api/worker/state/route.ts`, add the import:

```ts
import { readLimbo } from '@/lib/limbo-read';
```

Change the final return so the count is attached:

```ts
  const state = summarizeWorker({ heartbeat, now: Date.now(), running, queued, recentFinished, resolveRecipient });
  const limboCount = readLimbo().count;
  return NextResponse.json({ ...state, limboCount }, { headers: { 'Cache-Control': 'no-store' } });
```

- [ ] **Step 4: Show it in the indicator**

In `packages/web/app/components/WorkerStatus.tsx`, in the returned JSX of `WorkerStatus`, add an amber chip right after the status pill `<button>` (inside the same `<div ref={boxRef} className="relative">`, after the button and before `{open && ...}`):

```tsx
      {state.limboCount > 0 && (
        <a
          href="/status"
          className="badge badge-amber ml-2 cursor-pointer"
          title="Messages caught mid-send need your decision"
        >
          {state.limboCount} need a decision
        </a>
      )}
```

And in `OfflineBanner`, append to the status text span (after the queued/next line), a new line:

```tsx
        {state.limboCount > 0 && (
          <span className="font-semibold text-amber-900"> · {state.limboCount} need a decision</span>
        )}
```

- [ ] **Step 5: Build + full test run**

Run: `npm -w @event-drafter/web run build && npm test`
Expected: build succeeds; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/web/lib/worker-state.ts packages/web/lib/worker-state.test.ts packages/web/app/api/worker/state/route.ts packages/web/app/components/WorkerStatus.tsx
git commit -m "feat(web): surface stranded-send count on the worker indicator"
```

---

## Final verification

- [ ] `npm run build` clean (core + worker + web).
- [ ] `npm test` green (all workspaces).
- [ ] Manual smoke (optional, real DB): start web prod (`ED_DB_PATH=...$PWD/data/app.db npm -w @event-drafter/web run start -- --port 3007`), set an invite to `status='sending'` with a stuck `running` send_message job, load `/status`, confirm the row appears with both buttons, click Resend, confirm status flips to `approved`, a new `send_message` job is queued, and the stuck job is `failed`.
- [ ] `git push origin main`.

## Self-review notes

- Spec coverage: detection (T1/T2), prefilled auto-send gate (T1/T2), active-send exclusion + offline rule (T2), three record types (T2/T3), mark-sent/resend + orphan-job cleanup (T3), bulk resend-all-prefilled (T3/T4), /status section (T4), indicator count (T5). All covered.
- Single-send guarantee preserved: resend routes through `approved` and a fresh job, re-entering the normal claim path; nothing auto-sends.
