# Reactions → RSVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an invitee reacts to a WhatsApp invite with a positive emoji, mark them `yes`; with a negative emoji, mark them `no` — surfaced in the replies queue, never overriding a real text reply.

**Architecture:** All logic lives in the worker. A new pure module (`reactions.ts`) holds the emoji→RSVP mapping and precedence rule (unit-tested). The reader scrapes reaction aria-labels off the open chat; `check_replies` interprets them and upserts a `replies` row with `classification_source = 'reaction'`. The web `ReplyCard` shows a badge. No migration (the `classification_source` column already exists).

**Tech Stack:** TypeScript, Playwright (WA scraping), Drizzle ORM (SQLite), vitest, Next.js/React (badge).

## Global Constraints

- No new runtime dependencies. No DB migration — `replies.classification_source` already exists (TEXT, default `'llm'`).
- Mapping: positive emoji → `yes`, negative → `no`, everything else ignored. Exact emoji sets are defined in Task 1 and are the single source of truth.
- A reaction-seeded reply uses `classification_source = 'reaction'`, `classification_confidence = 1`, `classification_summary = "Reacted <emoji>"`.
- **Precedence:** a reply whose `classification_source` is `'llm'` or `'manual'` is never overwritten by a reaction. A reaction only seeds/refreshes when there is no reply or only a prior `'reaction'` one.
- No response draft is enqueued for a reaction (no `classify_reply` / draft job).
- Reaction DOM (verified live 2026-06-20): a `<button aria-label="reaction <emoji>. View reactions">` inside an outbound row (`div[role="row"]` containing `[data-icon="tail-out"]`). A reaction on our outbound bubble in a 1:1 chat is the recipient's.
- `reply_id` and ids are `number`. RSVP values `'yes'`/`'no'` are valid `invites.rsvp` values (mirrors `classify-reply.ts`).

---

### Task 1: Pure reaction logic + `'reaction'` classification source

**Files:**
- Create: `packages/worker/src/wa/reactions.ts`
- Test: `packages/worker/test/reactions.test.ts`
- Modify: `packages/core/src/types.ts:40` (add `'reaction'` to `CLASSIFICATION_SOURCES`)

**Interfaces:**
- Produces:
  - `extractReactionEmoji(ariaLabel: string): string | null`
  - `reactionToClassification(emoji: string): 'yes' | 'no' | null`
  - `chooseReactionRsvp(ariaLabels: string[]): { classification: 'yes' | 'no'; emoji: string } | null`
  - `reactionRsvpDecision(existingSource: string | null): 'upsert' | 'skip'`

- [ ] **Step 1: Add `'reaction'` to the classification-source union**

In `packages/core/src/types.ts`, change line 40 from:

```ts
export const CLASSIFICATION_SOURCES = ['llm', 'manual'] as const;
```

to:

```ts
export const CLASSIFICATION_SOURCES = ['llm', 'manual', 'reaction'] as const;
```

- [ ] **Step 2: Write the failing test**

Create `packages/worker/test/reactions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  extractReactionEmoji,
  reactionToClassification,
  chooseReactionRsvp,
  reactionRsvpDecision,
} from '../src/wa/reactions.js';

describe('extractReactionEmoji', () => {
  it('pulls the emoji out of a WA reaction aria-label', () => {
    expect(extractReactionEmoji('reaction 👍. View reactions')).toBe('👍');
  });
  it('handles a presentation-selector emoji (❤️)', () => {
    expect(extractReactionEmoji('reaction ❤️. View reactions')).toBe('❤️');
  });
  it('returns null when there is no emoji', () => {
    expect(extractReactionEmoji('View reactions')).toBeNull();
    expect(extractReactionEmoji('')).toBeNull();
  });
});

describe('reactionToClassification', () => {
  it('maps positive emoji to yes', () => {
    for (const e of ['👍', '❤️', '🥰', '🎉', '🙏', '👏', '✅', '🔥']) {
      expect(reactionToClassification(e)).toBe('yes');
    }
  });
  it('maps negative emoji to no', () => {
    for (const e of ['👎', '😢', '😭', '❌', '🚫']) {
      expect(reactionToClassification(e)).toBe('no');
    }
  });
  it('matches regardless of the VS16 presentation selector', () => {
    expect(reactionToClassification('❤')).toBe('yes'); // no U+FE0F
    expect(reactionToClassification('❤️')).toBe('yes'); // with U+FE0F
  });
  it('returns null for emoji with no clear signal', () => {
    for (const e of ['🤔', '😂', '👀', '']) {
      expect(reactionToClassification(e)).toBeNull();
    }
  });
});

describe('chooseReactionRsvp', () => {
  it('returns the classification and emoji for a single positive reaction', () => {
    expect(chooseReactionRsvp(['reaction 👍. View reactions'])).toEqual({
      classification: 'yes',
      emoji: '👍',
    });
  });
  it('picks the most recent (last in DOM order) mappable reaction', () => {
    expect(
      chooseReactionRsvp(['reaction 👍. View reactions', 'reaction 👎. View reactions']),
    ).toEqual({ classification: 'no', emoji: '👎' });
  });
  it('ignores unmappable reactions', () => {
    expect(chooseReactionRsvp(['reaction 🤔. View reactions'])).toBeNull();
  });
  it('returns null for no reactions', () => {
    expect(chooseReactionRsvp([])).toBeNull();
  });
});

describe('reactionRsvpDecision', () => {
  it('skips when a text reply already owns the row', () => {
    expect(reactionRsvpDecision('llm')).toBe('skip');
    expect(reactionRsvpDecision('manual')).toBe('skip');
  });
  it('upserts when there is no reply or only a prior reaction', () => {
    expect(reactionRsvpDecision(null)).toBe('upsert');
    expect(reactionRsvpDecision('reaction')).toBe('upsert');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm -w @event-drafter/worker run test -- reactions`
Expected: FAIL — `Cannot find module '../src/wa/reactions.js'`.

- [ ] **Step 4: Write the implementation**

Create `packages/worker/src/wa/reactions.ts`:

```ts
/**
 * Pure reaction-classification logic. WhatsApp Web (2026-06 build) renders a
 * recipient's reaction to our outbound message as a button with
 * aria-label="reaction <emoji>. View reactions" inside the outbound row. The
 * scraper hands the raw aria-labels here; this module extracts the emoji and
 * maps it to an RSVP. No DOM, no I/O — unit-tested.
 */

// Emoji are compared with any VS16 (U+FE0F) presentation selector stripped, so
// "❤️" (U+2764 U+FE0F) and "❤" (U+2764) map to the same entry.
const POSITIVE = new Set([
  '👍', '❤', '🥰', '😍', '🎉', '🙏', '👏', '✅', '💯', '🔥',
  '😊', '😁', '🤩', '🥳', '💖', '💕', '👌',
]);
const NEGATIVE = new Set(['👎', '😢', '😞', '😔', '😟', '😭', '❌', '🚫', '🙁', '☹']);

// U+FE0F = VS16 presentation selector, U+200D = ZWJ (joins compound emoji).
// Use explicit escapes, never literal invisible characters in source.
function normalizeEmoji(emoji: string): string {
  return emoji.replace(/️/g, '');
}

/** Pulls the emoji run out of a `reaction <emoji>. View reactions` aria-label. */
export function extractReactionEmoji(ariaLabel: string): string | null {
  const m = ariaLabel.match(/reaction\s+([\p{Extended_Pictographic}‍️]+)/u);
  return m ? m[1]! : null;
}

/** Maps a single emoji to an RSVP, or null if it carries no clear signal. */
export function reactionToClassification(emoji: string): 'yes' | 'no' | null {
  const e = normalizeEmoji(emoji);
  if (POSITIVE.has(e)) return 'yes';
  if (NEGATIVE.has(e)) return 'no';
  return null;
}

/**
 * Given the reaction aria-labels scraped from a chat (DOM order, oldest first),
 * pick the most recent one that maps to an RSVP. Returns the classification and
 * the emoji (for the reply summary), or null if none map.
 */
export function chooseReactionRsvp(
  ariaLabels: string[],
): { classification: 'yes' | 'no'; emoji: string } | null {
  let chosen: { classification: 'yes' | 'no'; emoji: string } | null = null;
  for (const label of ariaLabels) {
    const emoji = extractReactionEmoji(label);
    if (!emoji) continue;
    const classification = reactionToClassification(emoji);
    if (classification) chosen = { classification, emoji };
  }
  return chosen;
}

/**
 * Precedence: a real text reply (source 'llm' or 'manual') always wins, so a
 * reaction never overwrites it. A reaction only seeds/refreshes a row when there
 * is no reply or only a prior reaction-sourced one.
 */
export function reactionRsvpDecision(existingSource: string | null): 'upsert' | 'skip' {
  if (existingSource === 'llm' || existingSource === 'manual') return 'skip';
  return 'upsert';
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm -w @event-drafter/worker run test -- reactions`
Expected: PASS — all reaction tests green.

- [ ] **Step 6: Typecheck core (the union change has no other call sites to break)**

Run: `npm -w @event-drafter/core run build`
Expected: succeeds.

- [ ] **Step 7: Commit**

```bash
cd ~/event-drafter
git add packages/worker/src/wa/reactions.ts packages/worker/test/reactions.test.ts packages/core/src/types.ts
git commit -m "feat(reactions): pure emoji->RSVP logic + 'reaction' classification source"
```

---

### Task 2: Scrape reactions off the open chat

**Files:**
- Modify: `packages/worker/src/wa/reader.ts` (add `scrapeOutboundReactions`)
- Modify: `packages/worker/src/wa/driver.ts` (add `readChatReactions` wrapper)

**Interfaces:**
- Consumes: nothing from Task 1 (pure DOM scrape returning raw aria-labels).
- Produces:
  - `scrapeOutboundReactions(page: Page): Promise<string[]>` (reader)
  - `readChatReactions(): Promise<string[]>` (driver) — scrapes the **currently-open** chat; call immediately after `readChatInbound` for the same contact.

- [ ] **Step 1: Add the reader scrape**

In `packages/worker/src/wa/reader.ts`, append after `joinThreadText` (end of file):

```ts
/**
 * Scrapes the CURRENTLY-OPEN chat for reactions the recipient added to our
 * outbound messages. WA (2026-06 build) renders each as a button with
 * aria-label "reaction <emoji>. View reactions" inside the outbound row
 * (a div[role="row"] containing a [data-icon="tail-out"]). Returns the raw
 * aria-labels in DOM order (oldest → newest) for chooseReactionRsvp to
 * interpret. Best-effort: returns [] on any scrape error.
 */
export async function scrapeOutboundReactions(page: Page): Promise<string[]> {
  return page
    .evaluate(() => {
      const labels: string[] = [];
      const rows = Array.from(document.querySelectorAll('div[role="row"]'));
      for (const row of rows) {
        if (!row.querySelector('[data-icon="tail-out"]')) continue; // outbound only
        const badges = Array.from(row.querySelectorAll('[aria-label^="reaction "]'));
        for (const b of badges) {
          const l = (b.getAttribute('aria-label') || '').trim();
          if (l) labels.push(l);
        }
      }
      return labels;
    })
    .catch(() => []);
}
```

- [ ] **Step 2: Add the driver wrapper**

In `packages/worker/src/wa/driver.ts`, find the `readChatInbound` wrapper:

```ts
import { openChatAndReadInbound as _read, type ReadOpts } from './reader.js';

export async function readChatInbound(
  phoneE164: string,
  contactDisplayName?: string,
  opts: ReadOpts = {},
) {
  const { page } = await ensureContext();
  return _read(page, phoneE164, contactDisplayName, opts);
}
```

Change the import line to also pull in `scrapeOutboundReactions`, and add a wrapper right after `readChatInbound`:

```ts
import {
  openChatAndReadInbound as _read,
  scrapeOutboundReactions as _readReactions,
  type ReadOpts,
} from './reader.js';

export async function readChatInbound(
  phoneE164: string,
  contactDisplayName?: string,
  opts: ReadOpts = {},
) {
  const { page } = await ensureContext();
  return _read(page, phoneE164, contactDisplayName, opts);
}

/**
 * Reads reactions on the CURRENTLY-OPEN chat. Intended to be called right after
 * `readChatInbound(phone, ...)` for the same contact — that call leaves the page
 * on the contact's chat, so this scrapes it without an extra navigation.
 */
export async function readChatReactions(): Promise<string[]> {
  const { page } = await ensureContext();
  return _readReactions(page);
}
```

- [ ] **Step 3: Typecheck / build the worker**

Run: `npm -w @event-drafter/worker run build`
Expected: succeeds (no type errors). No unit test here — DOM scraping; the selector was validated live and the end-to-end check is Task 5.

- [ ] **Step 4: Commit**

```bash
cd ~/event-drafter
git add packages/worker/src/wa/reader.ts packages/worker/src/wa/driver.ts
git commit -m "feat(reactions): scrape recipient reactions off the open WA chat"
```

---

### Task 3: Seed RSVP from reactions in `check_replies`

**Files:**
- Modify: `packages/worker/src/jobs/check-replies.ts`

**Interfaces:**
- Consumes: `readChatReactions` (Task 2, driver); `chooseReactionRsvp`, `reactionRsvpDecision` (Task 1).
- Produces: no new exports — extends the per-invite loop body.

**Behavior:** after the existing text-reply handling for an invite (which must still run, and must NOT early-`continue` on an empty thread), scrape reactions on the open chat, choose an RSVP, and upsert a `'reaction'` reply + set the invite `rsvp` — unless a text reply already owns the row.

- [ ] **Step 1: Add imports**

In `packages/worker/src/jobs/check-replies.ts`, change:

```ts
import { ensureWaLoggedIn, readChatInbound } from '../wa/driver.js';
import { joinThreadText } from '../wa/reader.js';
```

to:

```ts
import { ensureWaLoggedIn, readChatInbound, readChatReactions } from '../wa/driver.js';
import { joinThreadText } from '../wa/reader.js';
import { chooseReactionRsvp, reactionRsvpDecision } from '../wa/reactions.js';
```

- [ ] **Step 2: Restructure the loop body so reactions always run**

In `check-replies.ts`, replace the block that currently starts at the empty-thread early-continue and runs through the text-reply transaction and its result logging — i.e. replace this exact span:

```ts
      if (thread.length === 0) {
        if (fullThread.length > 0 && anchor) {
          logger.info('check_replies: thread fully pre-invite — skipping', {
            invite_id: row.invite_id,
            event_id: row.event_id,
            anchor: anchor.toISOString(),
            visible: fullThread.length,
          });
        }
        await sleep(READ_GAP_MS);
        continue;
      }

      // The reader already walked back to our last outbound message, so
      // every message in `thread` is part of the contact's reply since we
      // last spoke. Roll it into a single reply row.
      const joinedText = joinThreadText(thread);
      const latest = thread[thread.length - 1]!;

      const result = db.transaction((tx) => {
        const existing = tx
          .select()
          .from(replies)
          .where(eq(replies.invite_id, row.invite_id))
          .get();

        if (existing) {
          // No change since last scan? Skip.
          if (existing.wa_message_text === joinedText && existing.wa_message_id === (latest.wa_message_id ?? null)) {
            return { action: 'noop' as const, reply_id: existing.id };
          }
          // Thread grew or changed. Update the row and clear any prior
          // classification + draft so the LLM re-reads the latest context.
          //
          // Even if we'd already sent a response in this thread, drop status
          // back to 'pending' so the operator sees a fresh draft for the new
          // message. response_sent_at is preserved as audit history so we
          // still know we previously replied. response_{approved,prefilled}_at
          // get cleared because they belong to the prior turn.
          tx.update(replies)
            .set({
              wa_message_id: latest.wa_message_id ?? null,
              wa_message_text: joinedText,
              wa_sent_at: latest.wa_sent_at,
              detected_at: new Date(),
              classification: null,
              classification_confidence: null,
              classification_summary: null,
              response_draft: null,
              response_status: 'pending',
              response_approved_at: null,
              response_prefilled_at: null,
            })
            .where(eq(replies.id, existing.id))
            .run();
          tx.insert(jobs).values({
            kind: 'classify_reply',
            payload: { reply_id: existing.id },
          }).run();
          return { action: 'updated' as const, reply_id: existing.id };
        }

        const inserted = tx.insert(replies).values({
          invite_id: row.invite_id,
          wa_message_id: latest.wa_message_id ?? null,
          wa_message_text: joinedText,
          wa_sent_at: latest.wa_sent_at,
          response_status: 'pending',
        }).returning().get();
        tx.insert(jobs).values({
          kind: 'classify_reply',
          payload: { reply_id: inserted.id },
        }).run();
        return { action: 'inserted' as const, reply_id: inserted.id };
      });

      if (result.action === 'inserted') {
        totalNew++;
        logger.info('check_replies: new reply', { invite_id: row.invite_id, reply_id: result.reply_id, threadLen: thread.length });
      } else if (result.action === 'updated') {
        totalUpdated++;
        logger.info('check_replies: thread updated', { invite_id: row.invite_id, reply_id: result.reply_id, threadLen: thread.length });
      }
```

with this (text handling now guarded by `thread.length > 0`, followed by an always-run reaction block, then the existing `sleep` continues the loop):

```ts
      // --- Text reply handling (only when there is a new inbound thread) ---
      if (thread.length === 0) {
        if (fullThread.length > 0 && anchor) {
          logger.info('check_replies: thread fully pre-invite — skipping', {
            invite_id: row.invite_id,
            event_id: row.event_id,
            anchor: anchor.toISOString(),
            visible: fullThread.length,
          });
        }
      } else {
        // The reader already walked back to our last outbound message, so
        // every message in `thread` is part of the contact's reply since we
        // last spoke. Roll it into a single reply row.
        const joinedText = joinThreadText(thread);
        const latest = thread[thread.length - 1]!;

        const result = db.transaction((tx) => {
          const existing = tx
            .select()
            .from(replies)
            .where(eq(replies.invite_id, row.invite_id))
            .get();

          if (existing) {
            // No change since last scan? Skip.
            if (existing.wa_message_text === joinedText && existing.wa_message_id === (latest.wa_message_id ?? null)) {
              return { action: 'noop' as const, reply_id: existing.id };
            }
            // Thread grew or changed. Update the row and clear any prior
            // classification + draft so the LLM re-reads the latest context.
            //
            // Even if we'd already sent a response in this thread, drop status
            // back to 'pending' so the operator sees a fresh draft for the new
            // message. response_sent_at is preserved as audit history so we
            // still know we previously replied. response_{approved,prefilled}_at
            // get cleared because they belong to the prior turn.
            tx.update(replies)
              .set({
                wa_message_id: latest.wa_message_id ?? null,
                wa_message_text: joinedText,
                wa_sent_at: latest.wa_sent_at,
                detected_at: new Date(),
                classification: null,
                classification_confidence: null,
                classification_summary: null,
                response_draft: null,
                response_status: 'pending',
                response_approved_at: null,
                response_prefilled_at: null,
              })
              .where(eq(replies.id, existing.id))
              .run();
            tx.insert(jobs).values({
              kind: 'classify_reply',
              payload: { reply_id: existing.id },
            }).run();
            return { action: 'updated' as const, reply_id: existing.id };
          }

          const inserted = tx.insert(replies).values({
            invite_id: row.invite_id,
            wa_message_id: latest.wa_message_id ?? null,
            wa_message_text: joinedText,
            wa_sent_at: latest.wa_sent_at,
            response_status: 'pending',
          }).returning().get();
          tx.insert(jobs).values({
            kind: 'classify_reply',
            payload: { reply_id: inserted.id },
          }).run();
          return { action: 'inserted' as const, reply_id: inserted.id };
        });

        if (result.action === 'inserted') {
          totalNew++;
          logger.info('check_replies: new reply', { invite_id: row.invite_id, reply_id: result.reply_id, threadLen: thread.length });
        } else if (result.action === 'updated') {
          totalUpdated++;
          logger.info('check_replies: thread updated', { invite_id: row.invite_id, reply_id: result.reply_id, threadLen: thread.length });
        }
      }

      // --- Reaction handling (always; the chat is still open) ---
      // The recipient may have reacted to our invite instead of (or as well as)
      // texting. A real text reply always wins (reactionRsvpDecision), so this
      // never overwrites an llm/manual reply. No draft is enqueued.
      const reaction = chooseReactionRsvp(await readChatReactions());
      if (reaction) {
        const rx = db.transaction((tx) => {
          const existing = tx
            .select()
            .from(replies)
            .where(eq(replies.invite_id, row.invite_id))
            .get();
          if (reactionRsvpDecision(existing?.classification_source ?? null) === 'skip') {
            return { action: 'rx-skip' as const, reply_id: existing?.id ?? 0 };
          }
          const summary = `Reacted ${reaction.emoji}`;
          let replyId: number;
          if (existing) {
            tx.update(replies)
              .set({
                classification: reaction.classification,
                classification_confidence: 1,
                classification_summary: summary,
                classification_source: 'reaction',
                detected_at: new Date(),
              })
              .where(eq(replies.id, existing.id))
              .run();
            replyId = existing.id;
          } else {
            const inserted = tx.insert(replies).values({
              invite_id: row.invite_id,
              wa_message_id: null,
              wa_message_text: summary,
              wa_sent_at: new Date(),
              classification: reaction.classification,
              classification_confidence: 1,
              classification_summary: summary,
              classification_source: 'reaction',
              response_status: 'pending',
            }).returning().get();
            replyId = inserted.id;
          }
          tx.update(invites)
            .set({ rsvp: reaction.classification })
            .where(eq(invites.id, row.invite_id))
            .run();
          return { action: existing ? ('rx-updated' as const) : ('rx-inserted' as const), reply_id: replyId };
        });

        if (rx.action === 'rx-inserted') {
          totalNew++;
          logger.info('check_replies: reaction RSVP', {
            invite_id: row.invite_id, reply_id: rx.reply_id, rsvp: reaction.classification, emoji: reaction.emoji,
          });
        } else if (rx.action === 'rx-updated') {
          totalUpdated++;
          logger.info('check_replies: reaction RSVP (updated)', {
            invite_id: row.invite_id, reply_id: rx.reply_id, rsvp: reaction.classification,
          });
        }
      }
```

(The existing `await sleep(READ_GAP_MS);` line immediately after this span stays as-is and ends the loop iteration.)

- [ ] **Step 3: Build the worker**

Run: `npm -w @event-drafter/worker run build`
Expected: succeeds. `invites` and `jobs` are already imported in this file; `eq` is already imported.

- [ ] **Step 4: Run the worker test suite (no regressions)**

Run: `npm -w @event-drafter/worker run test`
Expected: PASS — existing suites + Task 1's reaction tests all green.

- [ ] **Step 5: Commit**

```bash
cd ~/event-drafter
git add packages/worker/src/jobs/check-replies.ts
git commit -m "feat(reactions): seed yes/no RSVP from WA reactions in check_replies"
```

---

### Task 4: `'reaction'` badge in the replies queue card

**Files:**
- Modify: `packages/web/app/replies/ReplyCard.tsx` (the classification badge block, ~lines 192–201)

**Interfaces:**
- Consumes: `r.classification_source` on `ReplyRow` (already present and surfaced by `listAllReplies`).
- Produces: no new exports.

- [ ] **Step 1: Add the reaction branch to the badge**

In `packages/web/app/replies/ReplyCard.tsx`, replace this block:

```tsx
          {r.classification_source === 'manual' ? (
            <span className="mt-0.5 text-[10px] font-normal opacity-90" title="Classification set by operator">
              ✎ manual
            </span>
          ) : (
            r.confidence !== null && r.confidence !== undefined && (
              <span className="mt-0.5 text-[10px] font-normal opacity-90">
                {Math.round(r.confidence * 100)}%
              </span>
            )
          )}
```

with:

```tsx
          {r.classification_source === 'manual' ? (
            <span className="mt-0.5 text-[10px] font-normal opacity-90" title="Classification set by operator">
              ✎ manual
            </span>
          ) : r.classification_source === 'reaction' ? (
            <span className="mt-0.5 text-[10px] font-normal opacity-90" title="Set from a WhatsApp reaction">
              ⚡ reaction
            </span>
          ) : (
            r.confidence !== null && r.confidence !== undefined && (
              <span className="mt-0.5 text-[10px] font-normal opacity-90">
                {Math.round(r.confidence * 100)}%
              </span>
            )
          )}
```

- [ ] **Step 2: Build the web package**

Run: `npm -w @event-drafter/web run build`
Expected: succeeds (no type errors).

- [ ] **Step 3: Commit**

```bash
cd ~/event-drafter
git add packages/web/app/replies/ReplyCard.tsx
git commit -m "feat(reactions): show a 'reaction' badge on reaction-sourced replies"
```

---

### Task 5: Live end-to-end verification

**Files:** none (verification only). Uses the real DB + WhatsApp; the fixtures already exist (Gladys reacted 👍, David reacted ❤️ — verified during the design spike).

This exercises the full path: WA reaction → reader scrape → `check_replies` → `replies` row + invite RSVP. There is no automated test for this layer (live WA + DB); the pure logic is unit-tested in Task 1.

- [ ] **Step 1: Ensure the worker is running the new code**

If a worker is already running, restart it so it loads the rebuilt code (the worker runs via `tsx`, no watch):

```bash
pkill -f "tsx.*src/index.ts" || true
sleep 2
cd ~/event-drafter/packages/worker
ED_DB_PATH="$HOME/event-drafter/data/app.db" ED_WA_PROFILE_DIR="$HOME/event-drafter/data/wa-profile" \
  npx tsx --env-file=.env src/index.ts > /tmp/ed-worker.log 2>&1 &
```

Wait until `/tmp/ed-worker.log` shows `worker poller started`.

- [ ] **Step 2: Trigger a reply check**

Either click **Check now** on `/replies` in the browser, or enqueue directly:

```bash
sqlite3 ~/event-drafter/data/app.db "insert into jobs (kind, payload, status, created_at) values ('check_replies','{}','queued',strftime('%s','now')*1000);"
```

Watch the log for the reaction line:

```bash
grep "reaction RSVP" /tmp/ed-worker.log
```

Expected: a `check_replies: reaction RSVP` entry for Gladys's invite (👍 → yes) and/or David's (❤️ → yes), unless a text reply already owns that invite (then it's correctly skipped — confirm by checking that invite's existing reply source).

- [ ] **Step 3: Verify the DB state**

```bash
sqlite3 -header -column ~/event-drafter/data/app.db "
  select r.id, c.first_name, r.classification, r.classification_source, r.classification_summary, i.rsvp
  from replies r
  join invites i on i.id = r.invite_id
  join contacts c on c.id = i.contact_id
  where r.classification_source = 'reaction';"
```

Expected: at least one row, e.g. `Gladys | yes | reaction | Reacted 👍 | yes`.

- [ ] **Step 4: Verify the UI**

Open `http://localhost:3000/replies`. Expected: the reaction-sourced reply appears as a card with the `⚡ reaction` badge, classification YES (green), the summary line `Reacted 👍`, and the invite shows RSVP yes. A text reply on the same invite, if any, is unchanged (reaction did not override it).

- [ ] **Step 5: Record the result**

If the reaction reply appears with the correct classification, RSVP, and badge, the feature is verified end-to-end. If a reaction was skipped because a text reply already owned the invite, confirm that is the precedence rule working (not a bug) by checking the existing reply's `classification_source`.

---

## Self-Review

**Spec coverage:**
- Mapping positive→yes / negative→no / else ignored → Task 1 (`reactionToClassification`, emoji sets). ✓
- Reaction creates reply row (source `reaction`, conf 1, summary `Reacted <emoji>`) + sets RSVP, no draft → Task 3 (reaction transaction; no `classify_reply` enqueue). ✓
- Precedence: text reply (`llm`/`manual`) never overwritten; reaction only when none or prior `reaction` → Task 1 (`reactionRsvpDecision`) + Task 3 (applied in tx). ✓
- A later text reply overrides a reaction row → existing `check_replies` text path updates the row (clears classification, sets source back to default `llm` on the update? — note: the text-update path does NOT set `classification_source`, so it keeps `'reaction'`; see Gap below). 
- `classification_source = 'reaction'` added to union, no migration → Task 1. ✓
- UI badge mirroring `✎ manual` → Task 4. ✓
- DOM detection via `tail-out` row + `reaction <emoji>` aria-label → Task 2 (validated live in the spike). ✓
- Unit tests for the pure logic; live verification for DOM/DB → Tasks 1, 5. ✓

**Gap found & resolved:** the text-reply *update* path (Task 3, existing code) clears `classification` but does not reset `classification_source`, so a reaction row later receiving a text reply would keep `source = 'reaction'` while gaining real text + a `classify_reply` job. When `classify_reply` runs it sets `classification_source = 'llm'` (per `classify-reply.ts:58`), so the source self-corrects once classification completes. The transient state (text present, still `reaction` source, classification null, classify job queued) is correct and brief. No change needed; noted so a reviewer doesn't flag it as a precedence break.

**Placeholder scan:** none. All steps contain concrete code, exact commands, and expected output.

**Type consistency:** `chooseReactionRsvp` returns `{ classification: 'yes' | 'no'; emoji: string } | null` in Task 1 and is consumed that way in Task 3. `reactionRsvpDecision(existingSource: string | null)` signature matches between Task 1 and Task 3. `readChatReactions(): Promise<string[]>` matches between Task 2 (driver) and Task 3 (consumer). `classification_source` values `'llm' | 'manual' | 'reaction'` consistent across Tasks 1, 3, 4.
