# Targeted Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator pick an event, select specific invitees, set each one's logistics (food pref, chauffeur, parking coupon, our bus), then generate WhatsApp follow-up drafts (general, tailored, or from a merge-field template) that flow into the existing `/follow-ups` queue.

**Architecture:** Add per-invite logistics columns and a `message_templates` table in core. Add a pure core merge-renderer for template mode. Add a worker job `generate_targeted_follow_ups` that mirrors the existing `generate-follow-ups` job for the two LLM modes. Web server actions persist logistics, enqueue the job (LLM modes) or render+insert inline (template mode). A new `/events/[id]/follow-up` screen drives it. Generated rows reuse the `follow_ups` table and the existing approve/send pipeline unchanged.

**Tech Stack:** TypeScript, Drizzle ORM + better-sqlite3, Next.js (App Router, server actions), vitest, Anthropic SDK (in worker), Tailwind.

## Global Constraints

- **Channel is WhatsApp only.** No email. Drafts are short WhatsApp-style messages sent via the existing prefill pipeline. Do not add a send path — generated rows land in `follow_ups` (status `drafted`) and the existing `/follow-ups` UI sends them.
- **No em dashes** anywhere in generated or template output (house rule). Core renderer strips them; LLM output goes through `sanitizeDraft`.
- **UI follows the house system (anti-vibecode):** `card`, `badge`, `btn`, `field`, `eyebrow` classes; one accent; sentence-case; inline feedback banners; soft shadows; no spotlight gradients.
- **core & worker are ESM (`"type":"module"`)** — relative imports MUST carry a `.js` extension (e.g. `./foo.js`).
- **web (Next/Turbopack)** — relative *value* imports MUST be EXTENSIONLESS (e.g. `./actions`), and web imports core ONLY via package subpaths (e.g. `@event-drafter/core/message-templates`), never deep `dist/` paths.
- **Migrations** are generated with `npm -w @event-drafter/core run drizzle:generate -- --name <tag>` (drizzle-kit diffs schema vs the last snapshot and writes `drizzle/NNNN_<tag>.sql` + snapshot + journal). Re-migrate the dev DB with the ROOT script `npm run migrate` (the `-w core` form targets the wrong DB file).
- **Server actions** validate input with zod and return `{ ok: true, ... } | { ok: false, error: string }`. Import the DB via `import { getDb } from '@event-drafter/core/db'`.
- Every task ends green: run the touched package's `vitest run` (and `npx tsc --noEmit` where noted) before committing.

---

### Task 1: Core schema — invite logistics columns + `message_templates` table + migration

**Files:**
- Modify: `packages/core/src/schema/invites.ts` (add 4 columns)
- Create: `packages/core/src/schema/message-templates.ts`
- Modify: `packages/core/src/schema/index.ts` (export new table)
- Modify: `packages/core/package.json` (add `./message-templates` subpath export)
- Generate: `packages/core/drizzle/0015_targeted_followups.sql` (+ snapshot + journal, via drizzle-kit)
- Test: `packages/core/test/targeted-followups-schema.test.ts`

**Interfaces:**
- Produces: `invites.chauffeured: boolean`, `invites.parking_coupon: boolean`, `invites.takes_bus: boolean`, `invites.food_pref: string | null`; table `message_templates` with `{ id, name, body, created_at, updated_at }`; type exports `MessageTemplate`, `NewMessageTemplate`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/targeted-followups-schema.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '../src/migrate.js';
import { closeDb, getDb } from '../src/db.js';
import { contacts, events, invites, message_templates } from '../src/schema/index.js';
import { eq } from 'drizzle-orm';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'ed-tfu-schema-'));
  process.env.ED_DB_PATH = join(tmp, 'app.db');
  runMigrations();
});
afterEach(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

describe('targeted follow-up schema', () => {
  it('invites carry logistics columns with sane defaults', () => {
    const db = getDb();
    const ev = db.insert(events).values({ name: 'Gala', event_date: new Date() }).returning().get();
    const c = db.insert(contacts).values({ first_name: 'Ada', phone_e164: '+6512345678' }).returning().get();
    const inv = db.insert(invites).values({ event_id: ev.id, contact_id: c.id }).returning().get();
    expect(inv.chauffeured).toBe(false);
    expect(inv.parking_coupon).toBe(false);
    expect(inv.takes_bus).toBe(false);
    expect(inv.food_pref).toBeNull();

    db.update(invites)
      .set({ takes_bus: true, food_pref: 'vegetarian' })
      .where(eq(invites.id, inv.id))
      .run();
    const updated = db.select().from(invites).where(eq(invites.id, inv.id)).get();
    expect(updated?.takes_bus).toBe(true);
    expect(updated?.food_pref).toBe('vegetarian');
  });

  it('message_templates round-trips', () => {
    const db = getDb();
    const row = db
      .insert(message_templates)
      .values({ name: 'Parking note', body: 'Hi {first_name}, {parking}' })
      .returning()
      .get();
    expect(row.id).toBeGreaterThan(0);
    expect(row.name).toBe('Parking note');
    expect(row.body).toContain('{parking}');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @event-drafter/core exec -- vitest run test/targeted-followups-schema.test.ts`
Expected: FAIL — `message_templates` is not exported / columns undefined.

- [ ] **Step 3: Add the invite columns**

In `packages/core/src/schema/invites.ts`, inside the `invites` table object, add these after `attended_notes` (mirror the existing `attended` boolean and `attended_notes` text patterns):

```typescript
    chauffeured: integer('chauffeured', { mode: 'boolean' }).notNull().default(false),
    parking_coupon: integer('parking_coupon', { mode: 'boolean' }).notNull().default(false),
    takes_bus: integer('takes_bus', { mode: 'boolean' }).notNull().default(false),
    food_pref: text('food_pref'),
```

(`integer` and `text` are already imported in this file.)

- [ ] **Step 4: Create the `message_templates` table**

Create `packages/core/src/schema/message-templates.ts` (mirrors `wa-chat-cursors.ts`):

```typescript
import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const message_templates = sqliteTable('message_templates', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  body: text('body').notNull(),
  created_at: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updated_at: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export type MessageTemplate = typeof message_templates.$inferSelect;
export type NewMessageTemplate = typeof message_templates.$inferInsert;
```

- [ ] **Step 5: Export the new table**

In `packages/core/src/schema/index.ts`, add:

```typescript
export * from './message-templates.js';
```

- [ ] **Step 6: Add the core subpath export**

In `packages/core/package.json`, add to the `exports` map (after `./edm-templates`):

```json
    "./message-templates": "./dist/message-templates.js"
```

(This is for a core module created in Task 2; adding it now keeps the export map change in one place. The `dist` file will exist once core is built.)

- [ ] **Step 7: Generate the migration**

Run: `npm -w @event-drafter/core run drizzle:generate -- --name targeted_followups`
Expected: creates `packages/core/drizzle/0015_targeted_followups.sql`, updates `drizzle/meta/_journal.json` (16 entries) and writes `drizzle/meta/0015_snapshot.json`.

Inspect the SQL — it must contain 3 `ALTER TABLE \`invites\` ADD COLUMN` statements (chauffeured/parking_coupon/takes_bus as `integer ... DEFAULT false NOT NULL`), one `ADD COLUMN \`food_pref\` text`, and a `CREATE TABLE \`message_templates\``. If drizzle also emits unrelated diffs, stop and reconcile before continuing.

- [ ] **Step 8: Run test to verify it passes**

Run: `npm -w @event-drafter/core exec -- vitest run test/targeted-followups-schema.test.ts`
Expected: PASS (fresh temp DB runs all migrations including 0015).

- [ ] **Step 9: Re-migrate the dev DB and run the full core suite**

Run: `npm run migrate` (root — migrates `data/app.db`)
Run: `npm -w @event-drafter/core run test`
Expected: all green (existing schema tests still pass; new test passes).

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/schema packages/core/package.json packages/core/drizzle packages/core/test/targeted-followups-schema.test.ts
git commit -m "feat(core): invite logistics columns + message_templates table"
```

---

### Task 2: Core merge renderer (`renderMessageTemplate`, `deriveTemplateName`)

**Files:**
- Create: `packages/core/src/message-templates.ts` (pure logic; NOTE: different file from the schema `schema/message-templates.ts`)
- Test: `packages/core/test/message-templates.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `interface MergeContext { first_name: string; last_name?: string | null; event_name: string; event_date: Date; venue?: string | null; food_pref?: string | null; chauffeured: boolean; parking_coupon: boolean; takes_bus: boolean; }`
  - `renderMessageTemplate(body: string, ctx: MergeContext): string`
  - `deriveTemplateName(body: string, fallback?: string): string`
  - `const TOGGLE_PHRASES: { parking: string; bus: string; chauffeur: string }`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/message-templates.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  renderMessageTemplate,
  deriveTemplateName,
  TOGGLE_PHRASES,
  type MergeContext,
} from '../src/message-templates.js';

const base: MergeContext = {
  first_name: 'Ada',
  last_name: 'Lovelace',
  event_name: 'AI Summit',
  event_date: new Date('2026-08-01T00:00:00Z'),
  venue: 'Marina Bay',
  food_pref: null,
  chauffeured: false,
  parking_coupon: false,
  takes_bus: false,
};

describe('renderMessageTemplate', () => {
  it('substitutes plain tokens', () => {
    const out = renderMessageTemplate('Hi {first_name}, see you at {event_name} ({venue}).', base);
    expect(out).toBe('Hi Ada, see you at AI Summit (Marina Bay).');
  });

  it('expands a toggle token to its phrase when on, empty when off', () => {
    const on = renderMessageTemplate('Note: {parking}', { ...base, parking_coupon: true });
    expect(on).toBe(`Note: ${TOGGLE_PHRASES.parking}`);
    const off = renderMessageTemplate('Note:{parking}', base).trim();
    expect(off).toBe('Note:');
  });

  it('fills food_pref when present and blank when absent', () => {
    expect(renderMessageTemplate('Food: {food_pref}', { ...base, food_pref: 'halal' }))
      .toBe('Food: halal');
    expect(renderMessageTemplate('Food:{food_pref}', base).trim()).toBe('Food:');
  });

  it('leaves unknown tokens verbatim so typos are visible', () => {
    expect(renderMessageTemplate('Hi {frist_name}', base)).toBe('Hi {frist_name}');
  });

  it('collapses blank lines and double spaces left by empty tokens', () => {
    const body = 'Hi {first_name}.\n{parking}\n{bus}\nThanks.';
    // both toggles off -> the two middle lines vanish, no triple newline remains
    expect(renderMessageTemplate(body, base)).toBe('Hi Ada.\nThanks.');
  });

  it('strips em dashes (house rule)', () => {
    expect(renderMessageTemplate('Hi {first_name} — welcome', base)).toBe('Hi Ada, welcome');
  });
});

describe('deriveTemplateName', () => {
  it('uses the first non-empty line', () => {
    expect(deriveTemplateName('\n  Reminder blast \nmore')).toBe('Reminder blast');
  });
  it('truncates long first lines', () => {
    const long = 'x'.repeat(80);
    expect(deriveTemplateName(long)).toHaveLength(60);
  });
  it('falls back when empty', () => {
    expect(deriveTemplateName('   ')).toBe('Untitled template');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @event-drafter/core exec -- vitest run test/message-templates.test.ts`
Expected: FAIL — module `../src/message-templates.js` not found.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/message-templates.ts`:

```typescript
export interface MergeContext {
  first_name: string;
  last_name?: string | null;
  event_name: string;
  event_date: Date;
  venue?: string | null;
  food_pref?: string | null;
  chauffeured: boolean;
  parking_coupon: boolean;
  takes_bus: boolean;
}

/** Fixed phrases a toggle token expands to when the toggle is on (MVP defaults). */
export const TOGGLE_PHRASES = {
  parking: "We'll send you a parking coupon closer to the date.",
  bus: "You're on our shuttle, we'll share pickup details soon.",
  chauffeur: "We'll arrange a car to bring you to the venue.",
} as const;

const DATE_FMT: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric' };

/**
 * Render a merge-field template deterministically for one contact. Unknown
 * tokens are left verbatim so typos surface. Output is tidied: em dashes
 * stripped (house rule), and blank lines / double spaces left by empty tokens
 * collapsed.
 */
export function renderMessageTemplate(body: string, ctx: MergeContext): string {
  const tokens: Record<string, string> = {
    first_name: ctx.first_name,
    last_name: ctx.last_name ?? '',
    event_name: ctx.event_name,
    event_date: new Date(ctx.event_date).toLocaleDateString('en-SG', DATE_FMT),
    venue: ctx.venue ?? '',
    food_pref: ctx.food_pref ?? '',
    parking: ctx.parking_coupon ? TOGGLE_PHRASES.parking : '',
    bus: ctx.takes_bus ? TOGGLE_PHRASES.bus : '',
    chauffeur: ctx.chauffeured ? TOGGLE_PHRASES.chauffeur : '',
  };
  const filled = body.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in tokens ? tokens[key]! : whole,
  );
  return tidy(filled);
}

function tidy(text: string): string {
  return text
    .replace(/[—–]/g, ', ')       // strip em/en dashes (house rule)
    .replace(/[ \t]+\n/g, '\n')    // trailing spaces before a newline
    .replace(/\n[ \t]+/g, '\n')    // leading spaces after a newline
    .replace(/[ \t]{2,}/g, ' ')    // collapse runs of spaces
    .replace(/\n{2,}/g, '\n')      // an empty toggle line leaves a blank line -> collapse
    .replace(/ ,/g, ',')
    .replace(/,{2,}/g, ',')
    .trim();
}

/** Name for a saved template: first non-empty line, capped, or a fallback. */
export function deriveTemplateName(body: string, fallback = 'Untitled template'): string {
  const firstLine = body.split('\n').map((l) => l.trim()).find((l) => l.length > 0);
  if (!firstLine) return fallback;
  return firstLine.length > 60 ? firstLine.slice(0, 60) : firstLine;
}
```

Note on the blank-line test: with `\n{2,}` collapsing to a single `\n`, `Hi Ada.\n\n\nThanks.` (after the two toggle lines empty out) becomes `Hi Ada.\nThanks.`. If a template legitimately wants a paragraph break, that is a known MVP limitation (single-newline output); acceptable for short WhatsApp messages.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w @event-drafter/core exec -- vitest run test/message-templates.test.ts`
Expected: PASS.

- [ ] **Step 5: Build core so the subpath resolves for downstream packages**

Run: `npm -w @event-drafter/core run build`
Expected: emits `packages/core/dist/message-templates.js` (the subpath added in Task 1 now resolves).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/message-templates.ts packages/core/test/message-templates.test.ts
git commit -m "feat(core): deterministic merge-field template renderer"
```

---

### Task 3: Worker — targeted follow-up prompt builder

**Files:**
- Modify: `packages/worker/src/llm/prompts.ts` (add builder + interfaces + rules constant)
- Test: `packages/worker/test/targeted-prompt.test.ts`

**Interfaces:**
- Consumes: `PromptBlock`, `Event`, `Contact` types already used in `prompts.ts`.
- Produces:
  - `interface TargetedFollowUpLogistics { food_pref?: string | null; chauffeured: boolean; parking_coupon: boolean; takes_bus: boolean; }`
  - `interface TargetedFollowUpInput { event: Pick<Event,'name'|'event_date'|'venue'>; contact: Pick<Contact,'first_name'|'last_name'|'remarks'>; mode: 'general' | 'tailored'; logistics?: TargetedFollowUpLogistics; style_guide: string; operator_first_name?: string; }`
  - `buildTargetedFollowUpPrompt(input: TargetedFollowUpInput): PromptBlock`

- [ ] **Step 1: Write the failing test**

Create `packages/worker/test/targeted-prompt.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildTargetedFollowUpPrompt } from '../src/llm/prompts.js';

const event = { name: 'AI Summit', event_date: new Date('2026-08-01'), venue: 'Marina Bay' };
const contact = { first_name: 'Ada', last_name: 'Lovelace', remarks: null };
const style_guide = 'Warm and brief.';

describe('buildTargetedFollowUpPrompt', () => {
  it('tailored mode lists only the active logistics facts', () => {
    const p = buildTargetedFollowUpPrompt({
      event, contact, style_guide, mode: 'tailored',
      logistics: { food_pref: 'vegetarian', chauffeured: false, parking_coupon: true, takes_bus: false },
    });
    const text = p.user + JSON.stringify(p.system);
    expect(text).toContain('vegetarian');
    expect(text.toLowerCase()).toContain('parking');
    expect(text.toLowerCase()).not.toContain('shuttle'); // takes_bus off
    expect(text.toLowerCase()).not.toContain('chauffeur'); // chauffeured off
  });

  it('general mode omits the logistics block even if logistics are passed', () => {
    const p = buildTargetedFollowUpPrompt({
      event, contact, style_guide, mode: 'general',
      logistics: { food_pref: 'vegetarian', chauffeured: true, parking_coupon: true, takes_bus: true },
    });
    const text = p.user + JSON.stringify(p.system);
    expect(text).not.toContain('vegetarian');
    expect(text.toLowerCase()).not.toContain('parking coupon');
  });

  it('includes the contact name and style guide', () => {
    const p = buildTargetedFollowUpPrompt({ event, contact, style_guide, mode: 'general' });
    expect(p.user).toContain('Ada');
    expect(JSON.stringify(p.system)).toContain('Warm and brief.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @event-drafter/worker exec -- vitest run test/targeted-prompt.test.ts`
Expected: FAIL — `buildTargetedFollowUpPrompt` not exported.

- [ ] **Step 3: Write the implementation**

In `packages/worker/src/llm/prompts.ts`, append (reuse the existing `HUMAN_VOICE_RULES` constant already in the file, and the same `Event`/`Contact`/`PromptBlock` imports the file already has):

```typescript
const TARGETED_FOLLOW_UP_RULES = `You are writing a short WhatsApp follow-up to someone we already invited to an event. This is a nudge or a logistics update, not a fresh invite.

- 1 to 3 sentences. No sign-off block, no signature (it reads as a continuation of the same chat).
- Do not re-paste the original invite. Reference the event briefly by name.
- Warm, no pressure, no guilt-tripping about a missing reply.
- If a "Logistics to weave in" section is present, mention ONLY those points, briefly and naturally, as helpful updates. If it is absent, write a plain friendly reminder.

${HUMAN_VOICE_RULES}`;

export interface TargetedFollowUpLogistics {
  food_pref?: string | null;
  chauffeured: boolean;
  parking_coupon: boolean;
  takes_bus: boolean;
}

export interface TargetedFollowUpInput {
  event: Pick<Event, 'name' | 'event_date' | 'venue'>;
  contact: Pick<Contact, 'first_name' | 'last_name' | 'remarks'>;
  mode: 'general' | 'tailored';
  logistics?: TargetedFollowUpLogistics;
  style_guide: string;
  operator_first_name?: string;
}

export function buildTargetedFollowUpPrompt(input: TargetedFollowUpInput): PromptBlock {
  const eventDateStr = new Date(input.event.event_date).toLocaleDateString('en-SG', {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  const systemHeader = `# Style guide

${input.style_guide}

# Follow-up drafting rules

${TARGETED_FOLLOW_UP_RULES}

# Event context
Event: ${input.event.name}
When: ${eventDateStr}
Venue: ${input.event.venue ?? '(not specified)'}`;

  const logisticsLines: string[] = [];
  if (input.mode === 'tailored' && input.logistics) {
    const l = input.logistics;
    if (l.food_pref && l.food_pref.trim()) logisticsLines.push(`Dietary / food note: ${l.food_pref.trim()}`);
    if (l.parking_coupon) logisticsLines.push('We are giving them a parking coupon.');
    if (l.takes_bus) logisticsLines.push('They are riding our shuttle bus to the venue.');
    if (l.chauffeured) logisticsLines.push('We are arranging a car to chauffeur them.');
  }
  const logisticsBlock = logisticsLines.length
    ? `\n\n# Logistics to weave in (mention only these)\n${logisticsLines.map((s) => `- ${s}`).join('\n')}`
    : '';

  const fullName = `${input.contact.first_name}${input.contact.last_name ? ' ' + input.contact.last_name : ''}`;
  const userMessage = `# Contact
Name: ${fullName} (preferred: ${input.contact.first_name})
Remarks: ${input.contact.remarks ?? '(none)'}${logisticsBlock}

Draft the follow-up now.`;

  return {
    system: [{ type: 'text', text: systemHeader, cache_control: { type: 'ephemeral' } }],
    user: userMessage,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w @event-drafter/worker exec -- vitest run test/targeted-prompt.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/worker/src/llm/prompts.ts packages/worker/test/targeted-prompt.test.ts
git commit -m "feat(worker): targeted follow-up prompt builder (general + tailored)"
```

---

### Task 4: Worker — `generate_targeted_follow_ups` job

**Files:**
- Modify: `packages/core/src/types.ts` (add job kind to `JOB_KINDS`)
- Create: `packages/worker/src/jobs/generate-targeted-follow-ups.ts`
- Modify: `packages/worker/src/jobs/index.ts` (register handler)
- Test: `packages/worker/test/generate-targeted-follow-ups.test.ts`

**Interfaces:**
- Consumes: `buildTargetedFollowUpPrompt` (Task 3), `complete` from `../llm/client.js`, `sanitizeDraft` from `../llm/sanitize.js`.
- Payload shape enqueued by web (Task 6): `{ event_id: number, invite_ids: number[], mode: 'general' | 'tailored' }`.
- Produces: `generateTargetedFollowUpsHandler(job: Job): Promise<void>`; job kind `'generate_targeted_follow_ups'`.

- [ ] **Step 1: Add the job kind**

In `packages/core/src/types.ts`, add `'generate_targeted_follow_ups'` to the `JOB_KINDS` array (before `'cleanup_jobs'`):

```typescript
  'generate_targeted_follow_ups',
```

- [ ] **Step 2: Write the failing test**

Create `packages/worker/test/generate-targeted-follow-ups.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@event-drafter/core/migrate';
import { closeDb, getDb } from '@event-drafter/core/db';
import { events, contacts, invites, follow_ups } from '@event-drafter/core/schema';
import type { Job } from '@event-drafter/core';

// Mock the LLM client so the job does not hit Anthropic.
const completeMock = vi.fn(async () => ({
  text: 'Hi Ada, quick reminder about AI Summit. We have a parking coupon for you.',
  input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
}));
vi.mock('../src/llm/client.js', () => ({ complete: (...a: unknown[]) => completeMock(...a) }));

import { generateTargetedFollowUpsHandler } from '../src/jobs/generate-targeted-follow-ups.js';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'ed-tfu-job-'));
  process.env.ED_DB_PATH = join(tmp, 'app.db');
  runMigrations();
  completeMock.mockClear();
});
afterEach(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

function seed(): { eventId: number; inviteIds: number[] } {
  const db = getDb();
  const ev = db.insert(events).values({ name: 'AI Summit', event_date: new Date() }).returning().get();
  const ids: number[] = [];
  for (let i = 0; i < 2; i++) {
    const c = db.insert(contacts).values({ first_name: `C${i}`, phone_e164: `+65100000${i}` }).returning().get();
    const inv = db
      .insert(invites)
      .values({ event_id: ev.id, contact_id: c.id, status: 'sent', parking_coupon: true })
      .returning()
      .get();
    ids.push(inv.id);
  }
  return { eventId: ev.id, inviteIds: ids };
}

const asJob = (payload: unknown): Job => ({ payload } as unknown as Job);

describe('generateTargetedFollowUpsHandler', () => {
  it('drafts one follow_up per given invite regardless of reply/delay', async () => {
    const { eventId, inviteIds } = seed();
    await generateTargetedFollowUpsHandler(asJob({ event_id: eventId, invite_ids: inviteIds, mode: 'tailored' }));
    const rows = getDb().select().from(follow_ups).all();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === 'drafted')).toBe(true);
    expect(completeMock).toHaveBeenCalledTimes(2);
  });

  it('drafts only the invites named in the payload', async () => {
    const { eventId, inviteIds } = seed();
    await generateTargetedFollowUpsHandler(asJob({ event_id: eventId, invite_ids: [inviteIds[0]], mode: 'general' }));
    const rows = getDb().select().from(follow_ups).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.invite_id).toBe(inviteIds[0]);
  });

  it('no-ops on an empty invite list', async () => {
    const { eventId } = seed();
    await generateTargetedFollowUpsHandler(asJob({ event_id: eventId, invite_ids: [], mode: 'general' }));
    expect(getDb().select().from(follow_ups).all()).toHaveLength(0);
    expect(completeMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm -w @event-drafter/worker exec -- vitest run test/generate-targeted-follow-ups.test.ts`
Expected: FAIL — handler module not found.

- [ ] **Step 4: Write the job handler**

Create `packages/worker/src/jobs/generate-targeted-follow-ups.ts`:

```typescript
import type { Job } from '@event-drafter/core';
import { getDb } from '@event-drafter/core/db';
import { contacts, events, follow_ups, invites } from '@event-drafter/core/schema';
import { eq } from 'drizzle-orm';
import { getSetting } from '@event-drafter/core/settings';
import { complete } from '../llm/client.js';
import { buildTargetedFollowUpPrompt } from '../llm/prompts.js';
import { sanitizeDraft } from '../llm/sanitize.js';
import { logger } from '../logger.js';

const DEFAULT_STYLE_GUIDE = 'Brief and warm. 1-3 sentences. No emoji. No pressure.';

interface TargetedPayload {
  event_id?: number;
  invite_ids?: number[];
  mode?: 'general' | 'tailored';
}

export async function generateTargetedFollowUpsHandler(job: Job): Promise<void> {
  const db = getDb();
  const payload = (job.payload ?? {}) as TargetedPayload;
  const eventId = payload.event_id;
  const inviteIds = Array.isArray(payload.invite_ids) ? payload.invite_ids : [];
  const mode: 'general' | 'tailored' = payload.mode === 'tailored' ? 'tailored' : 'general';

  if (!eventId || inviteIds.length === 0) {
    logger.warn('generate_targeted_follow_ups: nothing to do', { eventId, count: inviteIds.length });
    return;
  }

  const event = db.select().from(events).where(eq(events.id, eventId)).get();
  if (!event) {
    logger.warn('generate_targeted_follow_ups: event not found', { eventId });
    return;
  }

  const style_guide = getSetting('style_guide') ?? DEFAULT_STYLE_GUIDE;
  let drafted = 0;

  for (const inviteId of inviteIds) {
    const inv = db.select().from(invites).where(eq(invites.id, inviteId)).get();
    if (!inv || inv.event_id !== eventId) continue;
    const contact = db.select().from(contacts).where(eq(contacts.id, inv.contact_id)).get();
    if (!contact) continue;

    const prompt = buildTargetedFollowUpPrompt({
      event,
      contact,
      mode,
      style_guide,
      logistics: {
        food_pref: inv.food_pref,
        chauffeured: inv.chauffeured,
        parking_coupon: inv.parking_coupon,
        takes_bus: inv.takes_bus,
      },
    });

    try {
      const result = await complete(prompt, 400);
      db.insert(follow_ups)
        .values({ invite_id: inviteId, draft_text: sanitizeDraft(result.text), status: 'drafted' })
        .run();
      drafted++;
    } catch (err) {
      logger.error('generate_targeted_follow_ups: draft failed', {
        invite_id: inviteId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info('generate_targeted_follow_ups: done', { drafted, requested: inviteIds.length });
}
```

- [ ] **Step 5: Register the handler**

In `packages/worker/src/jobs/index.ts`:
- Add the import (next to the other job imports):

```typescript
import { generateTargetedFollowUpsHandler } from './generate-targeted-follow-ups.js';
```

- Add to the `handlers` map (next to `generate_follow_ups`):

```typescript
  generate_targeted_follow_ups: generateTargetedFollowUpsHandler,
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm -w @event-drafter/worker exec -- vitest run test/generate-targeted-follow-ups.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Full core + worker suites green**

Run: `npm -w @event-drafter/core run test && npm -w @event-drafter/worker run test`
Expected: all green (the `JOB_KINDS` change keeps the registry exhaustive; unlisted kinds still default to noop).

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/types.ts packages/worker/src/jobs/generate-targeted-follow-ups.ts packages/worker/src/jobs/index.ts packages/worker/test/generate-targeted-follow-ups.test.ts
git commit -m "feat(worker): generate_targeted_follow_ups job"
```

---

### Task 5: Web — invitee listing + logistics persistence actions

**Files:**
- Create: `packages/web/app/events/[id]/follow-up/actions.ts`
- Test: `packages/web/app/events/[id]/follow-up/logistics.test.ts`

**Interfaces:**
- Produces:
  - `listInvitesForFollowUp(event_id: number)` → array of `{ invite_id, contact_id, first_name, last_name, phone_e164, remarks, rsvp, has_reply, chauffeured, parking_coupon, takes_bus, food_pref }`
  - `saveInviteLogistics(input)` where input `{ invite_id, chauffeured, parking_coupon, takes_bus, food_pref }` → `{ ok: true } | { ok: false, error }`

- [ ] **Step 1: Write the failing test**

Create `packages/web/app/events/[id]/follow-up/logistics.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@event-drafter/core/migrate';
import { closeDb, getDb } from '@event-drafter/core/db';
import { events, contacts, invites, replies } from '@event-drafter/core/schema';
import { eq } from 'drizzle-orm';

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

import { listInvitesForFollowUp, saveInviteLogistics } from './actions';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'ed-tfu-logi-'));
  process.env.ED_DB_PATH = join(tmp, 'app.db');
  runMigrations();
});
afterEach(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

function seed() {
  const db = getDb();
  const ev = db.insert(events).values({ name: 'Gala', event_date: new Date() }).returning().get();
  const c1 = db.insert(contacts).values({ first_name: 'Ada', phone_e164: '+6511' }).returning().get();
  const c2 = db.insert(contacts).values({ first_name: 'Bo', phone_e164: '+6512' }).returning().get();
  const i1 = db.insert(invites).values({ event_id: ev.id, contact_id: c1.id, status: 'sent' }).returning().get();
  const i2 = db.insert(invites).values({ event_id: ev.id, contact_id: c2.id, status: 'sent' }).returning().get();
  db.insert(replies).values({ invite_id: i2.id, wa_message_text: 'yes', wa_sent_at: new Date() }).run();
  return { eventId: ev.id, i1: i1.id, i2: i2.id };
}

describe('follow-up logistics actions', () => {
  it('lists the event invitees with a has_reply flag', async () => {
    const { eventId, i1, i2 } = seed();
    const rows = await listInvitesForFollowUp(eventId);
    expect(rows).toHaveLength(2);
    const byId = Object.fromEntries(rows.map((r) => [r.invite_id, r]));
    expect(byId[i1].has_reply).toBe(false);
    expect(byId[i2].has_reply).toBe(true);
    expect(byId[i1].chauffeured).toBe(false);
  });

  it('persists logistics to the invite', async () => {
    const { i1 } = seed();
    const res = await saveInviteLogistics({
      invite_id: i1, chauffeured: true, parking_coupon: false, takes_bus: true, food_pref: 'vegan',
    });
    expect(res).toEqual({ ok: true });
    const inv = getDb().select().from(invites).where(eq(invites.id, i1)).get();
    expect(inv?.chauffeured).toBe(true);
    expect(inv?.takes_bus).toBe(true);
    expect(inv?.food_pref).toBe('vegan');
  });

  it('rejects an unknown invite', async () => {
    const res = await saveInviteLogistics({
      invite_id: 999, chauffeured: true, parking_coupon: false, takes_bus: false, food_pref: null,
    });
    expect(res.ok).toBe(false);
  });

  it('rejects malformed input without throwing', async () => {
    const res = await saveInviteLogistics({ invite_id: -1 });
    expect(res.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @event-drafter/web exec -- vitest run app/events/[id]/follow-up/logistics.test.ts`
Expected: FAIL — `./actions` not found.

- [ ] **Step 3: Write the actions file**

Create `packages/web/app/events/[id]/follow-up/actions.ts`:

```typescript
'use server';

import { z } from 'zod';
import { getDb } from '@event-drafter/core/db';
import { contacts, events, follow_ups, invites, replies, message_templates } from '@event-drafter/core/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

export async function listInvitesForFollowUp(event_id: number) {
  const db = getDb();
  const repliedIds = new Set(
    db.select({ id: replies.invite_id }).from(replies).all().map((r) => r.id),
  );
  const rows = db
    .select({
      invite_id: invites.id,
      contact_id: contacts.id,
      first_name: contacts.first_name,
      last_name: contacts.last_name,
      phone_e164: contacts.phone_e164,
      remarks: contacts.remarks,
      rsvp: invites.rsvp,
      chauffeured: invites.chauffeured,
      parking_coupon: invites.parking_coupon,
      takes_bus: invites.takes_bus,
      food_pref: invites.food_pref,
    })
    .from(invites)
    .innerJoin(contacts, eq(invites.contact_id, contacts.id))
    .where(eq(invites.event_id, event_id))
    .orderBy(contacts.first_name)
    .all();
  return rows.map((r) => ({ ...r, has_reply: repliedIds.has(r.invite_id) }));
}

const logisticsSchema = z.object({
  invite_id: z.number().int().positive(),
  chauffeured: z.boolean(),
  parking_coupon: z.boolean(),
  takes_bus: z.boolean(),
  food_pref: z.string().max(200).nullable().optional(),
});

export async function saveInviteLogistics(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = logisticsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid input' };
  const { invite_id, chauffeured, parking_coupon, takes_bus, food_pref } = parsed.data;

  const db = getDb();
  const inv = db.select().from(invites).where(eq(invites.id, invite_id)).get();
  if (!inv) return { ok: false, error: 'Invite not found.' };

  db.update(invites)
    .set({ chauffeured, parking_coupon, takes_bus, food_pref: food_pref?.trim() || null })
    .where(eq(invites.id, invite_id))
    .run();
  revalidatePath(`/events/${inv.event_id}/follow-up`);
  return { ok: true };
}
```

(The extra imports `events`, `follow_ups`, `inArray`, `and`, `sql`, `message_templates` are used by Task 6, which extends this same file. Leaving them imported now avoids a second import edit; if your linter fails on unused imports, add them in Task 6 instead.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w @event-drafter/web exec -- vitest run app/events/[id]/follow-up/logistics.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add "packages/web/app/events/[id]/follow-up/actions.ts" "packages/web/app/events/[id]/follow-up/logistics.test.ts"
git commit -m "feat(web): invitee listing + logistics persistence actions"
```

---

### Task 6: Web — template library + draft-generation actions

**Files:**
- Modify: `packages/web/app/events/[id]/follow-up/actions.ts` (add 5 actions)
- Test: `packages/web/app/events/[id]/follow-up/generate.test.ts`

**Interfaces:**
- Consumes: `renderMessageTemplate`, `deriveTemplateName` from `@event-drafter/core/message-templates`; `saveInviteLogistics`/`listInvitesForFollowUp` file from Task 5.
- Produces:
  - `listTemplates()` → `MessageTemplate[]`
  - `saveTemplate(input: { name?: string, body: string })` → `{ ok, id }`
  - `deleteTemplate(input: { id: number })` → `{ ok }`
  - `generateTargetedFollowUps(input: { event_id, invite_ids, mode })` → `{ ok, count }` (enqueues the worker job)
  - `createTemplateFollowUps(input: { event_id, invite_ids, body, save_as_template?, template_name? })` → `{ ok, count }` (renders inline, inserts follow_ups)

- [ ] **Step 1: Write the failing test**

Create `packages/web/app/events/[id]/follow-up/generate.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@event-drafter/core/migrate';
import { closeDb, getDb } from '@event-drafter/core/db';
import { events, contacts, invites, follow_ups, jobs, message_templates } from '@event-drafter/core/schema';

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

import {
  generateTargetedFollowUps,
  createTemplateFollowUps,
  listTemplates,
  saveTemplate,
  deleteTemplate,
} from './actions';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'ed-tfu-gen-'));
  process.env.ED_DB_PATH = join(tmp, 'app.db');
  runMigrations();
});
afterEach(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

function seed() {
  const db = getDb();
  const ev = db.insert(events).values({ name: 'AI Summit', event_date: new Date('2026-08-01') }).returning().get();
  const c = db.insert(contacts).values({ first_name: 'Ada', phone_e164: '+6511' }).returning().get();
  const inv = db
    .insert(invites)
    .values({ event_id: ev.id, contact_id: c.id, status: 'sent', parking_coupon: true, food_pref: 'vegan' })
    .returning()
    .get();
  return { eventId: ev.id, inviteId: inv.id };
}

describe('draft-generation actions', () => {
  it('generateTargetedFollowUps enqueues a job with the right payload', async () => {
    const { eventId, inviteId } = seed();
    const res = await generateTargetedFollowUps({ event_id: eventId, invite_ids: [inviteId], mode: 'tailored' });
    expect(res).toEqual({ ok: true, count: 1 });
    const job = getDb().select().from(jobs).all()[0];
    expect(job?.kind).toBe('generate_targeted_follow_ups');
    expect(job?.payload).toEqual({ event_id: eventId, invite_ids: [inviteId], mode: 'tailored' });
    // template mode drafts are NOT created here
    expect(getDb().select().from(follow_ups).all()).toHaveLength(0);
  });

  it('createTemplateFollowUps renders per invite and inserts drafted follow_ups', async () => {
    const { eventId, inviteId } = seed();
    const res = await createTemplateFollowUps({
      event_id: eventId,
      invite_ids: [inviteId],
      body: 'Hi {first_name}, {parking} Food noted: {food_pref}.',
    });
    expect(res).toEqual({ ok: true, count: 1 });
    const rows = getDb().select().from(follow_ups).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('drafted');
    expect(rows[0]?.draft_text).toContain('Ada');
    expect(rows[0]?.draft_text).toContain('parking coupon');
    expect(rows[0]?.draft_text).toContain('vegan');
  });

  it('createTemplateFollowUps saves a template when asked, and CRUD round-trips', async () => {
    const { eventId, inviteId } = seed();
    await createTemplateFollowUps({
      event_id: eventId, invite_ids: [inviteId], body: 'Reminder for {first_name}', save_as_template: true,
    });
    let list = await listTemplates();
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe('Reminder for {first_name}');

    const saved = await saveTemplate({ name: 'Named', body: 'Body {venue}' });
    expect(saved.ok).toBe(true);
    list = await listTemplates();
    expect(list).toHaveLength(2);

    await deleteTemplate({ id: list[0]!.id });
    expect(await listTemplates()).toHaveLength(1);
  });

  it('createTemplateFollowUps rejects an empty body', async () => {
    const { eventId, inviteId } = seed();
    const res = await createTemplateFollowUps({ event_id: eventId, invite_ids: [inviteId], body: '   ' });
    expect(res.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @event-drafter/web exec -- vitest run app/events/[id]/follow-up/generate.test.ts`
Expected: FAIL — the 5 actions are not exported.

- [ ] **Step 3: Add the actions**

Append to `packages/web/app/events/[id]/follow-up/actions.ts` (imports already added in Task 5; add the core renderer import at the top):

```typescript
import { renderMessageTemplate, deriveTemplateName } from '@event-drafter/core/message-templates';
```

Then the actions:

```typescript
export async function listTemplates() {
  const db = getDb();
  return db.select().from(message_templates).orderBy(sql`${message_templates.updated_at} DESC`).all();
}

const saveTemplateSchema = z.object({
  name: z.string().max(120).optional(),
  body: z.string().min(1, 'Template body is empty.').max(4000),
});

export async function saveTemplate(
  input: unknown,
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const parsed = saveTemplateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid input' };
  const { name, body } = parsed.data;
  const db = getDb();
  const row = db
    .insert(message_templates)
    .values({ name: name?.trim() || deriveTemplateName(body), body })
    .returning()
    .get();
  return { ok: true, id: row.id };
}

const deleteTemplateSchema = z.object({ id: z.number().int().positive() });
export async function deleteTemplate(input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = deleteTemplateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid input' };
  getDb().delete(message_templates).where(eq(message_templates.id, parsed.data.id)).run();
  return { ok: true };
}

const generateSchema = z.object({
  event_id: z.number().int().positive(),
  invite_ids: z.array(z.number().int().positive()).min(1, 'Pick at least one contact.'),
  mode: z.enum(['general', 'tailored']),
});

export async function generateTargetedFollowUps(
  input: unknown,
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const parsed = generateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid input' };
  const { event_id, invite_ids, mode } = parsed.data;
  const db = getDb();
  db.insert(jobs).values({ kind: 'generate_targeted_follow_ups', payload: { event_id, invite_ids, mode } }).run();
  return { ok: true, count: invite_ids.length };
}

const templateGenSchema = z.object({
  event_id: z.number().int().positive(),
  invite_ids: z.array(z.number().int().positive()).min(1, 'Pick at least one contact.'),
  body: z.string().min(1, 'Template body is empty.').max(4000),
  save_as_template: z.boolean().optional(),
  template_name: z.string().max(120).optional(),
});

export async function createTemplateFollowUps(
  input: unknown,
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const parsed = templateGenSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid input' };
  const { event_id, invite_ids, body, save_as_template, template_name } = parsed.data;
  if (!body.trim()) return { ok: false, error: 'Template body is empty.' };

  const db = getDb();
  const event = db.select().from(events).where(eq(events.id, event_id)).get();
  if (!event) return { ok: false, error: 'Event not found.' };

  const rows = db
    .select({
      invite_id: invites.id,
      first_name: contacts.first_name,
      last_name: contacts.last_name,
      chauffeured: invites.chauffeured,
      parking_coupon: invites.parking_coupon,
      takes_bus: invites.takes_bus,
      food_pref: invites.food_pref,
    })
    .from(invites)
    .innerJoin(contacts, eq(invites.contact_id, contacts.id))
    .where(and(eq(invites.event_id, event_id), inArray(invites.id, invite_ids)))
    .all();

  let count = 0;
  db.transaction((tx) => {
    for (const r of rows) {
      const draft = renderMessageTemplate(body, {
        first_name: r.first_name,
        last_name: r.last_name,
        event_name: event.name,
        event_date: event.event_date,
        venue: event.venue,
        food_pref: r.food_pref,
        chauffeured: r.chauffeured,
        parking_coupon: r.parking_coupon,
        takes_bus: r.takes_bus,
      });
      tx.insert(follow_ups).values({ invite_id: r.invite_id, draft_text: draft, status: 'drafted' }).run();
      count++;
    }
    if (save_as_template && count > 0) {
      tx.insert(message_templates).values({ name: template_name?.trim() || deriveTemplateName(body), body }).run();
    }
  });

  revalidatePath('/follow-ups');
  return { ok: true, count };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w @event-drafter/web exec -- vitest run app/events/[id]/follow-up/generate.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck + full web suite**

Run: `npm -w @event-drafter/web exec -- tsc --noEmit && npm -w @event-drafter/web run test`
Expected: no type errors in the new files; all web tests green. (A pre-existing `limbo-read.test.ts` tsc warning is unrelated — see prior work.)

- [ ] **Step 6: Commit**

```bash
git add "packages/web/app/events/[id]/follow-up/actions.ts" "packages/web/app/events/[id]/follow-up/generate.test.ts"
git commit -m "feat(web): template library + targeted follow-up generation actions"
```

---

### Task 7: Web — compose screen UI + entry points

**Files:**
- Create: `packages/web/app/events/[id]/follow-up/page.tsx` (server component, loads data)
- Create: `packages/web/app/events/[id]/follow-up/FollowUpComposer.tsx` (client component)
- Modify: the event detail page (`packages/web/app/events/[id]/page.tsx`) — add a "Follow up" link
- Modify: `packages/web/app/follow-ups/page.tsx` — add a "New follow-up" entry (links to an event picker or, if an event is in context, directly)
- Create: `packages/web/app/follow-ups/new/page.tsx` (lightweight event picker → routes to `/events/[id]/follow-up`)

**Interfaces:**
- Consumes: all Task 5 + Task 6 actions, and `listEventsWithStats` from `packages/web/app/events/actions.ts` for the picker.

- [ ] **Step 1: Write the page (server component)**

Create `packages/web/app/events/[id]/follow-up/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { getDb } from '@event-drafter/core/db';
import { events } from '@event-drafter/core/schema';
import { eq } from 'drizzle-orm';
import { listInvitesForFollowUp, listTemplates } from './actions';
import { FollowUpComposer } from './FollowUpComposer';

export default async function FollowUpPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const eventId = Number(id);
  if (!Number.isFinite(eventId)) notFound();

  const event = getDb().select().from(events).where(eq(events.id, eventId)).get();
  if (!event) notFound();

  const [invitees, templates] = await Promise.all([
    listInvitesForFollowUp(eventId),
    listTemplates(),
  ]);

  return (
    <main className="mx-auto max-w-4xl p-6">
      <p className="eyebrow">Follow up</p>
      <h1 className="text-xl font-semibold">{event.name}</h1>
      <p className="mt-1 text-sm text-ink-2">
        Pick who to follow up with, set their logistics, then draft the messages.
      </p>
      <FollowUpComposer
        eventId={eventId}
        invitees={invitees}
        templates={templates}
      />
    </main>
  );
}
```

- [ ] **Step 2: Write the client composer**

Create `packages/web/app/events/[id]/follow-up/FollowUpComposer.tsx`. This is the largest piece; build it against the Task 5/6 action signatures. It must:

- Render a table of `invitees` with: a select checkbox (reuse the shift-click range pattern from `pick-contacts/page.tsx`), name, phone, an RSVP/`has_reply` badge, three toggle checkboxes (chauffeured / parking / bus) and a `food_pref` text input per row.
- On toggling a logistics control or blurring the food-pref input for a row, call `saveInviteLogistics({ invite_id, ...currentRowLogistics })` inside `useTransition`, updating local row state optimistically.
- A "Select all" / "Clear" control and a "N picked" counter.
- A compose panel with three tabs: **General**, **Tailored**, **Template**.
  - General / Tailored: a "Generate drafts" button → `generateTargetedFollowUps({ event_id, invite_ids: [...picked], mode })`; on `ok`, show a success banner and `router.push('/follow-ups')`.
  - Template: a `field` textarea with a merge-field hint line listing the tokens (`{first_name} {last_name} {event_name} {event_date} {venue} {food_pref} {parking} {bus} {chauffeur}`), a "Load template" `<select>` populated from `templates` (sets the textarea), a "Save as template" checkbox + optional name input, and a "Generate drafts" button → `createTemplateFollowUps({ event_id, invite_ids, body, save_as_template, template_name })`; on `ok`, banner + `router.push('/follow-ups')`.
- Disable every "Generate" button when `picked.size === 0` or a request is pending.
- Use house classes only (`card`, `btn`, `btn-primary`, `badge`, `field`, `eyebrow`), inline `{ kind: 'ok' | 'err', text }` banner feedback like the rest of the app, sentence-case labels, no em dashes.

Reference the exact multi-select state + shift-click `toggle` from `packages/web/app/events/[id]/pick-contacts/page.tsx` (lines ~2087-2111) and adapt it: the row model here is `invitees` keyed by `invite_id`.

Full skeleton (fill the table body + tabs per the bullets above; the state and handlers are complete):

```tsx
'use client';

import { useState, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  saveInviteLogistics,
  generateTargetedFollowUps,
  createTemplateFollowUps,
} from './actions';

type Invitee = {
  invite_id: number;
  contact_id: number;
  first_name: string;
  last_name: string | null;
  phone_e164: string;
  remarks: string | null;
  rsvp: string;
  has_reply: boolean;
  chauffeured: boolean;
  parking_coupon: boolean;
  takes_bus: boolean;
  food_pref: string | null;
};
type Template = { id: number; name: string; body: string };
type Banner = { kind: 'ok' | 'err'; text: string } | null;
const TOKENS = '{first_name} {last_name} {event_name} {event_date} {venue} {food_pref} {parking} {bus} {chauffeur}';

export function FollowUpComposer({
  eventId, invitees: initial, templates,
}: { eventId: number; invitees: Invitee[]; templates: Template[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<Invitee[]>(initial);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [lastIndex, setLastIndex] = useState<number | null>(null);
  const [tab, setTab] = useState<'general' | 'tailored' | 'template'>('general');
  const [body, setBody] = useState('');
  const [saveTpl, setSaveTpl] = useState(false);
  const [tplName, setTplName] = useState('');
  const [banner, setBanner] = useState<Banner>(null);
  const [isPending, start] = useTransition();

  const pickedIds = useMemo(() => Array.from(picked), [picked]);

  const toggleSelect = (id: number, index: number, shiftKey: boolean) => {
    const next = new Set(picked);
    if (shiftKey && lastIndex !== null && lastIndex !== index) {
      const [from, to] = lastIndex < index ? [lastIndex, index] : [index, lastIndex];
      const willSelect = !picked.has(id);
      for (let i = from; i <= to; i++) {
        const rid = rows[i]!.invite_id;
        if (willSelect) next.add(rid); else next.delete(rid);
      }
    } else {
      if (next.has(id)) next.delete(id); else next.add(id);
    }
    setPicked(next);
    setLastIndex(index);
  };

  const selectAll = () => setPicked(new Set(rows.map((r) => r.invite_id)));
  const clearAll = () => setPicked(new Set());

  const setLogistics = (invite_id: number, patch: Partial<Invitee>) => {
    setRows((rs) => rs.map((r) => (r.invite_id === invite_id ? { ...r, ...patch } : r)));
    const row = { ...rows.find((r) => r.invite_id === invite_id)!, ...patch };
    start(async () => {
      await saveInviteLogistics({
        invite_id,
        chauffeured: row.chauffeured,
        parking_coupon: row.parking_coupon,
        takes_bus: row.takes_bus,
        food_pref: row.food_pref,
      });
    });
  };

  const runLLM = (mode: 'general' | 'tailored') => {
    setBanner(null);
    start(async () => {
      const res = await generateTargetedFollowUps({ event_id: eventId, invite_ids: pickedIds, mode });
      if (!res.ok) { setBanner({ kind: 'err', text: res.error }); return; }
      router.push('/follow-ups');
    });
  };

  const runTemplate = () => {
    setBanner(null);
    start(async () => {
      const res = await createTemplateFollowUps({
        event_id: eventId, invite_ids: pickedIds, body,
        save_as_template: saveTpl, template_name: tplName || undefined,
      });
      if (!res.ok) { setBanner({ kind: 'err', text: res.error }); return; }
      router.push('/follow-ups');
    });
  };

  // TODO render: banner, invitee table (using toggleSelect / setLogistics),
  // select-all/clear + counter, the three tabs and their Generate buttons.
  // See the bullets in the plan task. Use house classes only.
  return (
    <div className="mt-6 space-y-6">
      {/* implement per task bullets */}
    </div>
  );
}
```

- [ ] **Step 3: Add the entry points**

- In `packages/web/app/events/[id]/page.tsx`, add a link near the other event actions:

```tsx
<Link href={`/events/${event.id}/follow-up`} className="btn btn-sm">Follow up</Link>
```

- Create `packages/web/app/follow-ups/new/page.tsx` — a server component that lists events (via `listEventsWithStats` from `packages/web/app/events/actions.ts`) as a simple `card` list, each linking to `/events/${id}/follow-up`:

```tsx
import Link from 'next/link';
import { listEventsWithStats } from '../../events/actions';

export default async function NewFollowUpPage() {
  const events = await listEventsWithStats();
  return (
    <main className="mx-auto max-w-3xl p-6">
      <p className="eyebrow">Follow up</p>
      <h1 className="text-xl font-semibold">Pick an event</h1>
      <ul className="mt-4 space-y-2">
        {events.map((e) => (
          <li key={e.id}>
            <Link href={`/events/${e.id}/follow-up`} className="card block p-4 hover:border-accent">
              <span className="font-medium">{e.name}</span>
              <span className="ml-2 badge badge-neutral">{e.total_invites} invited</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- In `packages/web/app/follow-ups/page.tsx`, add a "New follow-up" link/button in the header pointing to `/follow-ups/new`:

```tsx
<Link href="/follow-ups/new" className="btn btn-sm">New follow-up</Link>
```

- [ ] **Step 4: Implement the composer render body**

Fill in the `return` of `FollowUpComposer.tsx` per Step 2's bullets. Keep it in house style. Verify by typecheck and a dev run.

- [ ] **Step 5: Typecheck + build + full web suite**

Run: `npm -w @event-drafter/web exec -- tsc --noEmit`
Expected: no new type errors.
Run: `npm -w @event-drafter/web run test`
Expected: all green (Task 5/6 tests still pass).
Run: `npm run build`
Expected: core → worker → web all build; the new route compiles under Turbopack (watch for the extensionless-import rule).

- [ ] **Step 6: Manual smoke (dev)**

Run the app: `npm run dev` (root; serves web on the dev port with the real `data/app.db`).
- Open `/follow-ups/new`, pick an event with invitees.
- Toggle a couple of logistics controls + set a food pref; reload the page and confirm they persisted.
- Select 2 contacts, run **Tailored** → land on `/follow-ups`, confirm 2 new `drafted` rows appear within a poll cycle (worker must be running: `npm run dev:worker` in a second shell, or use `npm run dev:all`).
- Back on the composer, **Template** tab: type `Hi {first_name}, {parking}`, check "Save as template", Generate → confirm drafts appear immediately (template mode is inline) and the template shows in the "Load template" dropdown next time.

- [ ] **Step 7: Commit**

```bash
git add "packages/web/app/events/[id]/follow-up/page.tsx" "packages/web/app/events/[id]/follow-up/FollowUpComposer.tsx" "packages/web/app/events/[id]/page.tsx" "packages/web/app/follow-ups/page.tsx" "packages/web/app/follow-ups/new/page.tsx"
git commit -m "feat(web): targeted follow-up compose screen + entry points"
```

---

## Self-Review notes

- **Spec coverage:** event pick (Task 7 `/follow-ups/new`), contact select + "a few or all" (Task 7 table + select-all), logistics toggles + food-pref persistence on invite (Tasks 1, 5), general/tailored auto-draft via worker job (Tasks 3, 4, 6), merge-field template with library + reuse (Tasks 2, 6, 7), drafts into `/follow-ups` (Tasks 4, 6 write `follow_ups` status `drafted`). All mapped.
- **Type consistency:** `generateTargetedFollowUps` enqueues payload `{ event_id, invite_ids, mode }`; the worker handler (Task 4) reads exactly those keys. `renderMessageTemplate`'s `MergeContext` (Task 2) matches the object built in `createTemplateFollowUps` (Task 6). Job kind string `'generate_targeted_follow_ups'` identical in core `JOB_KINDS`, worker registry, and web enqueue.
- **Known soft spot:** Task 7 Step 2/4 leaves the composer JSX body as a guided TODO rather than fully-spelled markup, because it is large, purely presentational, and house-style-driven. The state, handlers, and all action wiring are fully specified; a reviewer gate on Step 5/6 (typecheck + build + manual smoke) covers it.
