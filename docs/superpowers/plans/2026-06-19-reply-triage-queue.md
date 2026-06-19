# Reply Triage Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/replies` a fast, keyboard-driven triage queue with optimistic collapse, auto-advance, and a 3-second Gmail-style undo on send.

**Architecture:** All client-side, contained to `packages/web/app/replies/`. Two pieces of real logic (highlight navigation, deferred-send timer) are extracted as pure, DOM-free modules and unit-tested with vitest. Thin React hooks/contexts wrap them. A new `RepliesQueue` client wrapper owns a `QueueProvider` (highlight state + card registry + global keydown + busy flag) and suppresses the existing `AutoRefresh` poll while the operator is engaged, so focus and in-flight timers aren't destroyed by a server re-render. No database, schema, worker, or send-pipeline changes.

**Tech Stack:** Next.js 16 (App Router, Server Components), React 19, TypeScript, Tailwind CSS, vitest.

## Global Constraints

- No new runtime dependencies. vitest is a **dev** dependency only (the repo already uses vitest in `@event-drafter/core` and `@event-drafter/worker`).
- No changes to server actions, job kinds, schema, migrations, or LLM prompts. Reuse existing actions verbatim: `approveResponse`, `skipResponse`, `markResponseSent`, `editResponse`, `regenerateResponse` (from `../events/[id]/actions`), `setReplyResolved`, `setReplyClassification` (from `./actions`).
- `reply_id` is a `number` throughout (see `ReplyRow` in `packages/web/app/replies/ReplyCard.tsx:43`).
- Undo window is **3000 ms**.
- `AutoRefresh` (`packages/web/app/components/AutoRefresh.tsx`) stays generic — it must NOT import any queue context (it is also used by `/contacts`, `/events`, etc.). Suppression happens by passing it a computed `active` prop.
- Keyboard shortcuts are inert while an `<input>` or `<textarea>` is focused, except `Escape`.
- Follow existing file conventions: `'use client'` directive on client modules, Tailwind utility classes, named exports.

---

### Task 1: Pure queue-navigation logic + web vitest setup

**Files:**
- Create: `packages/web/vitest.config.ts`
- Create: `packages/web/app/replies/queue-nav.ts`
- Test: `packages/web/app/replies/queue-nav.test.ts`
- Modify: `packages/web/package.json` (add `test` script + `vitest` devDependency)

**Interfaces:**
- Produces:
  - `stepHighlight(orderedIds: number[], current: number | null, isTerminal: (id: number) => boolean, dir: 1 | -1): number | null` — j/k navigation; skips terminal cards; stays put at the boundary; returns `null` only when the list is empty.
  - `advanceHighlight(orderedIds: number[], current: number | null, isTerminal: (id: number) => boolean): number | null` — post-action auto-advance; first non-terminal after `current`, else nearest non-terminal before, else `null`.

- [ ] **Step 1: Add the test script and vitest devDependency to web**

In `packages/web/package.json`, change the `scripts` block to add a `test` line:

```json
  "scripts": {
    "dev": "next dev --port 3000",
    "build": "next build",
    "start": "next start --port 3000",
    "lint": "next lint",
    "test": "vitest run"
  },
```

Add `vitest` to `devDependencies` (match the version already resolved in the repo lockfile; `@event-drafter/core` uses it). Then install:

```bash
cd ~/event-drafter && npm install --workspace @event-drafter/web --save-dev vitest
```

- [ ] **Step 2: Create the vitest config (node environment — these modules are pure)**

Create `packages/web/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['app/**/*.test.ts'],
  },
});
```

- [ ] **Step 3: Write the failing test**

Create `packages/web/app/replies/queue-nav.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { stepHighlight, advanceHighlight } from './queue-nav';

const none = () => false;

describe('stepHighlight', () => {
  it('moves to the next id going down', () => {
    expect(stepHighlight([1, 2, 3], 1, none, 1)).toBe(2);
  });
  it('moves to the previous id going up', () => {
    expect(stepHighlight([1, 2, 3], 2, none, -1)).toBe(1);
  });
  it('stays put at the bottom boundary', () => {
    expect(stepHighlight([1, 2, 3], 3, none, 1)).toBe(3);
  });
  it('stays put at the top boundary', () => {
    expect(stepHighlight([1, 2, 3], 1, none, -1)).toBe(1);
  });
  it('skips terminal cards', () => {
    const terminal = (id: number) => id === 2;
    expect(stepHighlight([1, 2, 3], 1, terminal, 1)).toBe(3);
  });
  it('from null going down picks the first non-terminal', () => {
    expect(stepHighlight([1, 2, 3], null, none, 1)).toBe(1);
  });
  it('returns null for an empty list', () => {
    expect(stepHighlight([], null, none, 1)).toBeNull();
  });
});

describe('advanceHighlight', () => {
  it('lands on the next non-terminal after current', () => {
    const terminal = (id: number) => id === 2;
    expect(advanceHighlight([1, 2, 3], 2, terminal)).toBe(3);
  });
  it('falls back to the nearest non-terminal before when none after', () => {
    const terminal = (id: number) => id === 3;
    expect(advanceHighlight([1, 2, 3], 3, terminal)).toBe(2);
  });
  it('returns null when every card is terminal', () => {
    expect(advanceHighlight([1, 2, 3], 2, () => true)).toBeNull();
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm -w @event-drafter/web run test`
Expected: FAIL — `Cannot find module './queue-nav'`.

- [ ] **Step 5: Write the implementation**

Create `packages/web/app/replies/queue-nav.ts`:

```ts
/**
 * Pure highlight navigation for the reply triage queue. No React, no DOM —
 * unit-tested in queue-nav.test.ts.
 *
 * "Terminal" cards are ones the operator has already actioned (sending/sent/
 * skipped/resolved) and collapsed; the highlight skips over them.
 */

/** j/k navigation: step one card in `dir`, skipping terminal cards. Stays on
 *  `current` at the boundary. Returns null only for an empty list. */
export function stepHighlight(
  orderedIds: number[],
  current: number | null,
  isTerminal: (id: number) => boolean,
  dir: 1 | -1,
): number | null {
  if (orderedIds.length === 0) return null;
  const start = current === null ? (dir === 1 ? -1 : orderedIds.length) : orderedIds.indexOf(current);
  for (let i = start + dir; i >= 0 && i < orderedIds.length; i += dir) {
    if (!isTerminal(orderedIds[i])) return orderedIds[i];
  }
  return current;
}

/** Post-action auto-advance: first non-terminal after `current`; else the
 *  nearest non-terminal before it; else null (queue cleared). */
export function advanceHighlight(
  orderedIds: number[],
  current: number | null,
  isTerminal: (id: number) => boolean,
): number | null {
  const start = current === null ? -1 : orderedIds.indexOf(current);
  for (let i = start + 1; i < orderedIds.length; i++) {
    if (!isTerminal(orderedIds[i])) return orderedIds[i];
  }
  for (let i = start - 1; i >= 0; i--) {
    if (!isTerminal(orderedIds[i])) return orderedIds[i];
  }
  return null;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm -w @event-drafter/web run test`
Expected: PASS — 10 tests green.

- [ ] **Step 7: Commit**

```bash
cd ~/event-drafter
git add packages/web/package.json packages/web/vitest.config.ts packages/web/app/replies/queue-nav.ts packages/web/app/replies/queue-nav.test.ts package-lock.json
git commit -m "feat(replies): pure queue-navigation logic + web vitest setup"
```

---

### Task 2: Deferred-send controller (Gmail-style undo)

**Files:**
- Create: `packages/web/app/replies/deferred-send.ts`
- Test: `packages/web/app/replies/deferred-send.test.ts`

**Interfaces:**
- Produces:
  - `type SendState = { phase: 'idle' } | { phase: 'sending' } | { phase: 'sent' } | { phase: 'error'; message: string }`
  - `interface DeferredSend { readonly state: SendState; send(): void; undo(): void; dispose(): void }`
  - `createDeferredSend(opts: { onSend: () => Promise<void>; delayMs: number; onChange: (s: SendState) => void }): DeferredSend`

- [ ] **Step 1: Write the failing test**

Create `packages/web/app/replies/deferred-send.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDeferredSend, type SendState } from './deferred-send';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createDeferredSend', () => {
  it('fires onSend after the delay and reaches "sent"', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const d = createDeferredSend({ onSend, delayMs: 3000, onChange: () => {} });
    d.send();
    expect(d.state.phase).toBe('sending');
    await vi.advanceTimersByTimeAsync(3000);
    expect(onSend).toHaveBeenCalledOnce();
    expect(d.state.phase).toBe('sent');
  });

  it('undo before the delay cancels the send entirely', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const d = createDeferredSend({ onSend, delayMs: 3000, onChange: () => {} });
    d.send();
    d.undo();
    expect(d.state.phase).toBe('idle');
    await vi.advanceTimersByTimeAsync(3000);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('reaches "error" when onSend rejects', async () => {
    const onSend = vi.fn().mockRejectedValue(new Error('boom'));
    const d = createDeferredSend({ onSend, delayMs: 3000, onChange: () => {} });
    d.send();
    await vi.advanceTimersByTimeAsync(3000);
    expect(d.state).toEqual({ phase: 'error', message: 'boom' });
  });

  it('emits each state transition through onChange', async () => {
    const seen: SendState[] = [];
    const d = createDeferredSend({
      onSend: () => Promise.resolve(),
      delayMs: 3000,
      onChange: (s) => seen.push(s),
    });
    d.send();
    await vi.advanceTimersByTimeAsync(3000);
    expect(seen.map((s) => s.phase)).toEqual(['sending', 'sent']);
  });

  it('ignores send() when not idle', () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const d = createDeferredSend({ onSend, delayMs: 3000, onChange: () => {} });
    d.send();
    d.send();
    expect(d.state.phase).toBe('sending');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm -w @event-drafter/web run test`
Expected: FAIL — `Cannot find module './deferred-send'`.

- [ ] **Step 3: Write the implementation**

Create `packages/web/app/replies/deferred-send.ts`:

```ts
/**
 * Framework-agnostic Gmail-style deferred send. `send()` starts a timer; the
 * real `onSend` only fires after `delayMs`, so `undo()` within the window
 * cancels it before anything is enqueued. Unit-tested with fake timers in
 * deferred-send.test.ts; wrapped by the useDeferredSend React hook.
 */
export type SendState =
  | { phase: 'idle' }
  | { phase: 'sending' }
  | { phase: 'sent' }
  | { phase: 'error'; message: string };

export interface DeferredSend {
  readonly state: SendState;
  send(): void;
  undo(): void;
  dispose(): void;
}

export function createDeferredSend(opts: {
  onSend: () => Promise<void>;
  delayMs: number;
  onChange: (s: SendState) => void;
}): DeferredSend {
  let state: SendState = { phase: 'idle' };
  let timer: ReturnType<typeof setTimeout> | null = null;

  const set = (s: SendState) => {
    state = s;
    opts.onChange(s);
  };

  return {
    get state() {
      return state;
    },
    send() {
      if (state.phase !== 'idle') return;
      set({ phase: 'sending' });
      timer = setTimeout(async () => {
        timer = null;
        try {
          await opts.onSend();
          set({ phase: 'sent' });
        } catch (e) {
          set({ phase: 'error', message: e instanceof Error ? e.message : 'send failed' });
        }
      }, opts.delayMs);
    },
    undo() {
      if (state.phase !== 'sending') return;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      set({ phase: 'idle' });
    },
    dispose() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm -w @event-drafter/web run test`
Expected: PASS — Task 1 + Task 2 tests all green.

- [ ] **Step 5: Commit**

```bash
cd ~/event-drafter
git add packages/web/app/replies/deferred-send.ts packages/web/app/replies/deferred-send.test.ts
git commit -m "feat(replies): deferred-send controller with 3s undo"
```

---

### Task 3: QueueProvider — highlight state, card registry, keydown, busy flag

**Files:**
- Create: `packages/web/app/replies/QueueProvider.tsx`

**Interfaces:**
- Consumes: `stepHighlight`, `advanceHighlight` from `./queue-nav` (Task 1); `AutoRefresh` from `../components/AutoRefresh`.
- Produces:
  - `interface CardHandlers { primary: () => void; focusEditor: () => void; isTerminal: () => boolean }`
  - `interface QueueApi { highlightedId: number | null; registerCard: (id: number, h: CardHandlers) => () => void; addPending: (id: number) => void; removePending: (id: number) => void }`
  - `useQueue(): QueueApi` — throws if used outside the provider.
  - `<QueueProvider orderedIds={number[]} active={boolean}>{children}</QueueProvider>` — renders children, installs the global keydown listener, and renders a suppression-aware `AutoRefresh` internally.

**Notes on behavior:**
- `engaged = highlightedId !== null`. `busy = engaged || pending.size > 0`. The internal `AutoRefresh` is rendered with `active={active && !busy}`, so the server re-render is suppressed while the operator is navigating or a send timer is running.
- Keydown is ignored when `document.activeElement` is an `<input>`/`<textarea>` unless the key is `Escape`.
- `j`/`ArrowDown`, `k`/`ArrowUp` call `stepHighlight` (terminal predicate from each card's registered `isTerminal`). `Enter` calls the highlighted card's `primary()`. `e` calls `focusEditor()`. `Escape` blurs the active element.

- [ ] **Step 1: Write the implementation**

Create `packages/web/app/replies/QueueProvider.tsx`:

```tsx
'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AutoRefresh } from '../components/AutoRefresh';
import { stepHighlight, advanceHighlight } from './queue-nav';

export interface CardHandlers {
  primary: () => void;
  focusEditor: () => void;
  isTerminal: () => boolean;
}

export interface QueueApi {
  highlightedId: number | null;
  registerCard: (id: number, h: CardHandlers) => () => void;
  addPending: (id: number) => void;
  removePending: (id: number) => void;
}

const QueueCtx = createContext<QueueApi | null>(null);

export function useQueue(): QueueApi {
  const ctx = useContext(QueueCtx);
  if (!ctx) throw new Error('useQueue must be used within <QueueProvider>');
  return ctx;
}

function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

export function QueueProvider({
  orderedIds,
  active,
  children,
}: {
  orderedIds: number[];
  active: boolean;
  children: ReactNode;
}) {
  const [highlightedId, setHighlightedId] = useState<number | null>(null);
  const [pending, setPending] = useState<Set<number>>(() => new Set());
  const cards = useRef<Map<number, CardHandlers>>(new Map());

  const addPending = useCallback((id: number) => {
    setPending((p) => {
      const n = new Set(p);
      n.add(id);
      return n;
    });
  }, []);
  const removePending = useCallback((id: number) => {
    setPending((p) => {
      const n = new Set(p);
      n.delete(id);
      return n;
    });
  }, []);

  const registerCard = useCallback((id: number, h: CardHandlers) => {
    cards.current.set(id, h);
    return () => {
      cards.current.delete(id);
    };
  }, []);

  const isTerminal = useCallback(
    (id: number) => cards.current.get(id)?.isTerminal() ?? false,
    [],
  );

  // Keep the latest orderedIds/highlightedId readable inside the keydown
  // listener without re-binding it on every render.
  const navRef = useRef({ orderedIds, highlightedId, isTerminal });
  navRef.current = { orderedIds, highlightedId, isTerminal };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isEditableTarget(document.activeElement)) {
          (document.activeElement as HTMLElement).blur();
          e.preventDefault();
        }
        return;
      }
      if (isEditableTarget(e.target)) return;

      const { orderedIds: ids, highlightedId: cur, isTerminal: term } = navRef.current;

      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightedId(stepHighlight(ids, cur, term, 1));
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedId(stepHighlight(ids, cur, term, -1));
      } else if (e.key === 'Enter') {
        if (cur === null) return;
        e.preventDefault();
        cards.current.get(cur)?.primary();
        // The actioned card becomes terminal synchronously (collapse / sending);
        // a microtask lets that settle before we advance off it.
        queueMicrotask(() => {
          const n = navRef.current;
          setHighlightedId(advanceHighlight(n.orderedIds, cur, n.isTerminal));
        });
      } else if (e.key === 'e') {
        if (cur === null) return;
        e.preventDefault();
        cards.current.get(cur)?.focusEditor();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const busy = highlightedId !== null || pending.size > 0;

  const api = useMemo<QueueApi>(
    () => ({ highlightedId, registerCard, addPending, removePending }),
    [highlightedId, registerCard, addPending, removePending],
  );

  return (
    <QueueCtx.Provider value={api}>
      <AutoRefresh active={active && !busy} />
      {children}
    </QueueCtx.Provider>
  );
}
```

- [ ] **Step 2: Typecheck via build**

Run: `npm -w @event-drafter/web run build`
Expected: build succeeds (no type errors). The provider is not yet rendered anywhere, so this only verifies it compiles.

- [ ] **Step 3: Commit**

```bash
cd ~/event-drafter
git add packages/web/app/replies/QueueProvider.tsx
git commit -m "feat(replies): QueueProvider — highlight, card registry, keydown, refresh suppression"
```

---

### Task 4: useDeferredSend React hook

**Files:**
- Create: `packages/web/app/replies/useDeferredSend.ts`

**Interfaces:**
- Consumes: `createDeferredSend`, `SendState` from `./deferred-send` (Task 2).
- Produces: `useDeferredSend(onSend: () => Promise<void>, delayMs?: number): { state: SendState; send: () => void; undo: () => void }` (defaults `delayMs` to 3000).

- [ ] **Step 1: Write the implementation**

Create `packages/web/app/replies/useDeferredSend.ts`:

```ts
'use client';

import { useEffect, useRef, useState } from 'react';
import { createDeferredSend, type DeferredSend, type SendState } from './deferred-send';

export function useDeferredSend(onSend: () => Promise<void>, delayMs = 3000) {
  const [state, setState] = useState<SendState>({ phase: 'idle' });

  // Always call the freshest onSend without re-creating the controller.
  const onSendRef = useRef(onSend);
  onSendRef.current = onSend;

  const ctrl = useRef<DeferredSend | null>(null);
  if (ctrl.current === null) {
    ctrl.current = createDeferredSend({
      onSend: () => onSendRef.current(),
      delayMs,
      onChange: setState,
    });
  }

  useEffect(() => () => ctrl.current?.dispose(), []);

  return {
    state,
    send: () => ctrl.current!.send(),
    undo: () => ctrl.current!.undo(),
  };
}
```

- [ ] **Step 2: Typecheck via build**

Run: `npm -w @event-drafter/web run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
cd ~/event-drafter
git add packages/web/app/replies/useDeferredSend.ts
git commit -m "feat(replies): useDeferredSend hook wrapping the deferred-send controller"
```

---

### Task 5: RepliesQueue wrapper + wire into page.tsx

**Files:**
- Create: `packages/web/app/replies/RepliesQueue.tsx`
- Modify: `packages/web/app/replies/page.tsx` (remove the top-level `<AutoRefresh>` and the inline card `<ul>`; render `<RepliesQueue>` in the reply-list branch; keep a plain `<AutoRefresh>` in the awaiting branch)

**Interfaces:**
- Consumes: `QueueProvider` from `./QueueProvider` (Task 3); `ReplyCard`, `ReplyRow` from `./ReplyCard` (Task 6 reworks ReplyCard but its `{ r: ReplyRow }` prop is unchanged, so this task compiles against the current ReplyCard).
- Produces: `<RepliesQueue replies={ReplyRow[]} active={boolean} />`.

- [ ] **Step 1: Create RepliesQueue**

Create `packages/web/app/replies/RepliesQueue.tsx`:

```tsx
'use client';

import { QueueProvider } from './QueueProvider';
import { ReplyCard, type ReplyRow } from './ReplyCard';

export function RepliesQueue({ replies, active }: { replies: ReplyRow[]; active: boolean }) {
  const orderedIds = replies.map((r) => r.reply_id);
  return (
    <QueueProvider orderedIds={orderedIds} active={active}>
      <ul className="space-y-2">
        {replies.map((r) => (
          <ReplyCard key={r.reply_id} r={r} />
        ))}
      </ul>
    </QueueProvider>
  );
}
```

- [ ] **Step 2: Wire it into page.tsx — remove the top-level AutoRefresh**

In `packages/web/app/replies/page.tsx`, delete the standalone refresh line (currently line 92):

```tsx
      <AutoRefresh active={inFlight} />
```

(The awaiting branch and the queue branch will each render their own refresh below.)

- [ ] **Step 3: Add a plain AutoRefresh to the awaiting branch**

Still in `page.tsx`, in the `filter === 'awaiting'` branch, add `<AutoRefresh active={inFlight} />` just inside it. Change the opening of that branch from:

```tsx
      {filter === 'awaiting' ? (
        awaiting.length === 0 ? (
```

to:

```tsx
      {filter === 'awaiting' ? (
        <>
        <AutoRefresh active={inFlight} />
        {awaiting.length === 0 ? (
```

and close the fragment at the end of the awaiting branch — change:

```tsx
          </ul>
        )
      ) : visibleReplies.length === 0 ? (
```

to:

```tsx
          </ul>
        )}
        </>
      ) : visibleReplies.length === 0 ? (
```

- [ ] **Step 4: Replace the inline card list with RepliesQueue**

Still in `page.tsx`, replace the final `<ul>` map (currently lines 173-179):

```tsx
      ) : (
        <ul className="space-y-2">
          {visibleReplies.map((r) => (
            <ReplyCard key={r.reply_id} r={r as ReplyRow} />
          ))}
        </ul>
      )}
```

with:

```tsx
      ) : (
        <RepliesQueue replies={visibleReplies as ReplyRow[]} active={inFlight} />
      )}
```

- [ ] **Step 5: Fix imports in page.tsx**

At the top of `page.tsx`, remove the now-unused `ReplyCard` import and add `RepliesQueue`. Change:

```tsx
import { ReplyCard, type ReplyRow } from './ReplyCard';
```

to:

```tsx
import { type ReplyRow } from './ReplyCard';
import { RepliesQueue } from './RepliesQueue';
```

(`AutoRefresh` is still imported and used in the awaiting branch — leave its import.)

- [ ] **Step 6: Typecheck via build**

Run: `npm -w @event-drafter/web run build`
Expected: build succeeds. At runtime the queue now renders through `RepliesQueue`; behavior is unchanged from the user's view until Task 6 adds the card interactions.

- [ ] **Step 7: Commit**

```bash
cd ~/event-drafter
git add packages/web/app/replies/RepliesQueue.tsx packages/web/app/replies/page.tsx
git commit -m "feat(replies): RepliesQueue wrapper with suppression-aware refresh"
```

---

### Task 6: Rework ReplyCard — keyboard primary action, optimistic collapse, visual hierarchy

**Files:**
- Modify: `packages/web/app/replies/ReplyCard.tsx` (full rewrite of the component body; `ReplyRow` interface and the `CLASSIFY_OPTIONS`/`ago`/`classificationVisual` helpers are unchanged)

**Interfaces:**
- Consumes: `useQueue`, `CardHandlers` from `./QueueProvider` (Task 3); `useDeferredSend` from `./useDeferredSend` (Task 4); existing server actions (see Global Constraints).
- Produces: unchanged public surface — `export function ReplyCard({ r }: { r: ReplyRow })` and `export interface ReplyRow`.

**Behavior:**
- Local `localState`: `'active' | 'collapsed'`, plus the `useDeferredSend` `state` for the sending sub-states. A card is **terminal** (for navigation/`isTerminal`) when `localState === 'collapsed'` OR the deferred-send `state.phase` is `'sending'`/`'sent'`.
- Registers `{ primary, focusEditor, isTerminal }` with the queue via `registerCard` in an effect.
- `primary()`:
  - if `status === 'prefilled'` → `markSent()` (collapse, no timer);
  - else if the approve button would be enabled (`editValue.trim()` and status not `approved`/`sent`) → `approveAndSend()` (deferred);
  - else no-op.
- `approveAndSend()`: `send()` from the deferred hook (whose `onSend` calls `approveResponse`), `addPending(reply_id)`, and advance the highlight. Collapse to the sending row. On undo: `undo()`, `removePending`, re-expand. On `sent`: `removePending`, keep collapsed. On `error`: `removePending`, re-expand with an inline error.
- `skip()` / `resolve()` / `markSent()`: call the action inside `start(...)`, then collapse and advance. These do not use the timer.
- Highlighted card gets a left accent ring.

- [ ] **Step 1: Rewrite ReplyCard.tsx**

Replace the entire contents of `packages/web/app/replies/ReplyCard.tsx` with:

```tsx
'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  approveResponse,
  skipResponse,
  markResponseSent,
  editResponse,
  regenerateResponse,
} from '../events/[id]/actions';
import { setReplyResolved, setReplyClassification } from './actions';
import { useQueue } from './QueueProvider';
import { useDeferredSend } from './useDeferredSend';

const CLASSIFY_OPTIONS = [
  { value: 'yes', label: 'Yes', cls: 'bg-green-600 text-white border-green-700' },
  { value: 'no', label: 'No', cls: 'bg-red-600 text-white border-red-700' },
  { value: 'maybe', label: 'Maybe', cls: 'bg-amber-500 text-white border-amber-600' },
  { value: 'unclear', label: 'Unclear', cls: 'bg-neutral-500 text-white border-neutral-600' },
] as const;

function ago(ts: Date | number | null | undefined): string {
  if (!ts) return '—';
  const ms = Date.now() - (ts instanceof Date ? ts.getTime() : Number(ts));
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

interface ClassificationVisual { label: string; glyph: string; cls: string }

function classificationVisual(c: string | null | undefined): ClassificationVisual {
  switch (c) {
    case 'yes': return { label: 'YES', glyph: '✓', cls: 'bg-green-600 text-white border-green-700 ring-2 ring-green-200' };
    case 'no': return { label: 'NO', glyph: '✕', cls: 'bg-red-600 text-white border-red-700 ring-2 ring-red-200' };
    case 'maybe': return { label: 'MAYBE', glyph: '?', cls: 'bg-amber-500 text-white border-amber-600 ring-2 ring-amber-200' };
    case 'unclear': return { label: 'UNCLEAR', glyph: '…', cls: 'bg-neutral-500 text-white border-neutral-600 ring-2 ring-neutral-200' };
    default: return { label: 'UNCLASSIFIED', glyph: '·', cls: 'bg-neutral-200 text-neutral-700 border-neutral-300' };
  }
}

export interface ReplyRow {
  reply_id: number;
  event_id: number;
  event_name: string;
  classification: string | null;
  confidence: number | null;
  summary: string | null;
  classification_source: string | null;
  reply_text: string;
  response_draft: string | null;
  response_status: string | null;
  response_sent_at: Date | null;
  wa_sent_at: Date | null;
  detected_at: Date | null;
  resolved: boolean;
  resolved_at: Date | null;
  contact_name: string;
}

export function ReplyCard({ r }: { r: ReplyRow }) {
  const router = useRouter();
  const queue = useQueue();
  const [isPending, start] = useTransition();
  const [edit, setEdit] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<null | 'skipped' | 'resolved' | 'sentManual'>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const editValue = edit ?? r.response_draft ?? '';
  const dirty = (r.response_draft ?? '') !== editValue;
  const cv = classificationVisual(r.classification);
  const status = r.response_status ?? 'pending';
  const refresh = () => router.refresh();

  const canApprove = !!editValue.trim() && status !== 'approved' && status !== 'sent';

  const send = useDeferredSend(async () => {
    await approveResponse({ reply_id: r.reply_id });
    queue.removePending(r.reply_id);
    refresh();
  });

  // A card is terminal once it has collapsed or a send is in flight/done.
  const terminal =
    collapsed !== null || send.state.phase === 'sending' || send.state.phase === 'sent';

  // Auto-advance after an action lives in QueueProvider's Enter handler, which
  // reads each card's isTerminal(); the card itself does not push the highlight.

  const approveAndSend = () => {
    queue.addPending(r.reply_id);
    send.send();
  };

  const undoSend = () => {
    send.undo();
    queue.removePending(r.reply_id);
  };

  const doCollapse = (kind: 'skipped' | 'resolved' | 'sentManual', action: () => Promise<unknown>) => {
    start(async () => {
      await action();
      setCollapsed(kind);
      refresh();
    });
  };

  // Register keyboard handlers with the queue.
  useEffect(() => {
    const primary = () => {
      if (status === 'prefilled') {
        doCollapse('sentManual', () => markResponseSent({ reply_id: r.reply_id }));
      } else if (canApprove) {
        approveAndSend();
      }
    };
    const focusEditor = () => textareaRef.current?.focus();
    const isTerminal = () => terminal;
    return queue.registerCard(r.reply_id, { primary, focusEditor, isTerminal });
    // re-register when the inputs to these closures change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.reply_id, status, canApprove, terminal]);

  const highlighted = queue.highlightedId === r.reply_id;

  // ---- Collapsed render ----
  if (terminal) {
    let label: string;
    if (send.state.phase === 'sending') label = `✓ sending to ${r.contact_name}…`;
    else if (send.state.phase === 'sent') label = `✓ sent to ${r.contact_name}`;
    else if (collapsed === 'skipped') label = '↷ skipped';
    else if (collapsed === 'resolved') label = '✓ resolved';
    else label = `✓ sent to ${r.contact_name}`;

    return (
      <li className="flex items-center justify-between rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-600">
        <span>{label}</span>
        {send.state.phase === 'sending' && (
          <button
            onClick={undoSend}
            className="rounded border border-neutral-300 bg-white px-2 py-0.5 text-xs font-medium text-blue-700 hover:bg-neutral-50"
          >
            undo
          </button>
        )}
      </li>
    );
  }

  // ---- Expanded render ----
  let stateLabel: string;
  let stateCls: string;
  const hadPriorResponse = !!r.response_sent_at;
  const inboundAfterReply =
    hadPriorResponse &&
    r.wa_sent_at &&
    r.response_sent_at &&
    new Date(r.wa_sent_at as unknown as Date).getTime() >
      new Date(r.response_sent_at as unknown as Date).getTime();
  if (r.resolved) {
    stateLabel = 'resolved'; stateCls = 'bg-neutral-200 text-neutral-600';
  } else if (status === 'pending' && hadPriorResponse && !inboundAfterReply) {
    stateLabel = 'awaiting their reply'; stateCls = 'bg-neutral-100 text-neutral-600';
  } else if (status === 'pending' && inboundAfterReply) {
    stateLabel = 'they replied again'; stateCls = 'bg-amber-100 text-amber-800';
  } else if (status === 'pending') {
    stateLabel = 'needs review'; stateCls = 'bg-blue-100 text-blue-800';
  } else {
    stateLabel = status; stateCls = 'bg-neutral-100 text-neutral-600';
  }

  return (
    <li
      className={`rounded border bg-white p-3 text-sm space-y-2 ${
        highlighted ? 'border-blue-400 ring-2 ring-blue-200' : 'border-neutral-200'
      } ${r.resolved ? 'opacity-70' : ''}`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`flex flex-none flex-col items-center justify-center rounded-md border px-2 py-1 text-xs font-semibold ${cv.cls}`}
          title={`Classification: ${cv.label}`}
        >
          <span className="text-base leading-none">{cv.glyph}</span>
          <span className="mt-0.5 leading-none tracking-wide">{cv.label}</span>
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
        </div>

        <div className="flex-1 space-y-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <strong>{r.contact_name}</strong>
            <Link href={`/events/${r.event_id}/replies`} className="text-xs text-blue-700 underline">
              {r.event_name}
            </Link>
            <span className={`rounded px-2 py-0.5 text-xs ${stateCls}`}>{stateLabel}</span>
          </div>
          {r.summary && <p className="text-xs italic text-neutral-600">{r.summary}</p>}
          <p className="text-xs text-neutral-500" suppressHydrationWarning>
            {r.detected_at ? new Date(r.detected_at as unknown as Date).toLocaleString() : ''}
            {r.resolved && r.resolved_at ? ` · resolved ${ago(r.resolved_at as unknown as Date)}` : ''}
          </p>
        </div>

        <div className="flex w-28 flex-none flex-col gap-1">
          <button
            onClick={() => doCollapse('resolved', () => setReplyResolved({ reply_id: r.reply_id, resolved: !r.resolved }))}
            disabled={isPending}
            className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
          >
            {r.resolved ? 'Reopen' : 'Mark resolved'}
          </button>

          <button
            onClick={() => setPickerOpen((o) => !o)}
            disabled={isPending}
            className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
            title="Override the classification regardless of the LLM's read"
          >
            Mark it as {pickerOpen ? '▴' : '▾'}
          </button>

          {pickerOpen && (
            <div className="grid grid-cols-2 gap-1">
              {CLASSIFY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  disabled={isPending}
                  onClick={() =>
                    start(async () => {
                      await setReplyClassification({ reply_id: r.reply_id, classification: opt.value });
                      setPickerOpen(false);
                      refresh();
                    })
                  }
                  className={`rounded border px-1.5 py-1 text-xs font-semibold disabled:opacity-50 ${opt.cls} ${
                    r.classification === opt.value ? 'ring-2 ring-neutral-400 ring-offset-1' : 'opacity-90 hover:opacity-100'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rounded bg-neutral-50 p-2 text-sm">
        <p className="text-xs text-neutral-500">Their reply:</p>
        <p className="whitespace-pre-wrap">{r.reply_text}</p>
      </div>

      <textarea
        ref={textareaRef}
        className="h-20 w-full rounded border border-neutral-300 p-2 text-sm"
        value={editValue}
        onChange={(e) => setEdit(e.target.value)}
        placeholder="(no draft yet)"
      />

      {send.state.phase === 'error' && (
        <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">
          Send failed: {send.state.message}. Try Approve &amp; send again.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {status === 'prefilled' ? (
          <>
            <span className="rounded bg-yellow-100 px-2 py-1 text-yellow-800">
              ✋ Pre-filled in WA — click send there, then:
            </span>
            <button
              onClick={() => doCollapse('sentManual', () => markResponseSent({ reply_id: r.reply_id }))}
              className="rounded bg-green-700 px-3 py-1.5 font-medium text-white"
            >
              Mark sent
            </button>
          </>
        ) : (
          <>
            <button
              disabled={isPending || !canApprove}
              onClick={approveAndSend}
              className="rounded bg-green-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-700 disabled:opacity-50"
            >
              ✓ Approve &amp; send
            </button>
            <button
              disabled={!dirty || isPending || status === 'sent'}
              onClick={() => start(async () => { await editResponse({ reply_id: r.reply_id, response_draft: editValue }); setEdit(null); refresh(); })}
              className="rounded border border-neutral-300 px-2 py-1 text-neutral-600 disabled:opacity-50"
            >
              Save edits
            </button>
            <button
              disabled={isPending || status === 'sent'}
              onClick={() => doCollapse('skipped', () => skipResponse({ reply_id: r.reply_id }))}
              className="rounded border border-neutral-300 px-2 py-1 text-neutral-600 disabled:opacity-50"
            >
              Skip
            </button>
            <button
              disabled={isPending || status === 'approved' || status === 'prefilled' || status === 'sent'}
              onClick={() => start(async () => { await regenerateResponse({ reply_id: r.reply_id }); setEdit(null); refresh(); })}
              className="rounded border border-neutral-300 px-2 py-1 text-neutral-600 disabled:opacity-50"
              title="Re-run the LLM to draft a fresh response"
            >
              ↻ Regenerate
            </button>
          </>
        )}
      </div>
    </li>
  );
}
```

- [ ] **Step 2: Typecheck via build**

Run: `npm -w @event-drafter/web run build`
Expected: build succeeds with no unused-variable or type errors. (Auto-advance is already implemented in `QueueProvider`'s `Enter` branch from Task 3 — the card does not push the highlight itself.)

- [ ] **Step 3: Run the unit tests (ensure nothing regressed)**

Run: `npm -w @event-drafter/web run test`
Expected: PASS — all Task 1 + Task 2 tests still green.

- [ ] **Step 4: Commit**

```bash
cd ~/event-drafter
git add packages/web/app/replies/ReplyCard.tsx
git commit -m "feat(replies): keyboard triage card — collapse, deferred send, hierarchy"
```

---

### Task 7: Manual verification pass (Playwright MCP on the dev server)

**Files:** none (verification only).

This task has no unit tests — it exercises the React glue and the keyboard loop end-to-end against a running server. Use the Playwright MCP browser tools.

- [ ] **Step 1: Start the dev server**

```bash
cd ~/event-drafter && npm run dev
```

Wait for `web` to report listening on `http://localhost:3000`. (Per project memory, the worker's tsx watch can orphan — that does not affect this UI verification.)

- [ ] **Step 2: Seed at least two unresolved replies if none exist**

Open `http://localhost:3000/replies`. If the active queue is empty, click **Check now** (or use an existing event with replies). You need ≥2 cards in the `all` filter to test navigation. If the environment has no WhatsApp data, note this limitation and verify what is possible (hierarchy, highlight, keydown inertness in the textarea) with whatever cards exist.

- [ ] **Step 3: Verify navigation and hierarchy**

- Press `j` — the first card gains a blue accent ring (highlight). Press `j` again — highlight moves to the next card; `k` moves back. At the bottom, `j` stays put.
- Confirm `Approve & send` is the visually dominant (solid green, larger) button on each card; Skip / Regenerate / Resolve are muted.

- [ ] **Step 4: Verify the textarea does not capture nav keys**

- Press `e` on the highlighted card — focus lands in its draft textarea.
- Type `jjjk hello` — the text appears literally in the textarea; the highlight does NOT move.
- Press `Escape` — focus leaves the textarea. `j`/`k` move the highlight again.

- [ ] **Step 5: Verify deferred send + undo**

- Highlight a card with a non-empty draft and press `Enter`. The card collapses to `✓ sending to <name>… [undo]` and the highlight auto-advances to the next card.
- Click **undo** within 3 seconds. The card re-expands; confirm (via the dev DB or the worker log) that **no `send_response` job row was created** for that `reply_id`.
- Press `Enter` again on the same card and let the 3s elapse. It settles to `✓ sent to <name>` and a `send_response` job is enqueued (worker picks it up).

- [ ] **Step 6: Verify refresh suppression**

- With a card highlighted (or a send in its 3s window), confirm the list does not re-render/jump underneath you. (You can trigger background activity with **Check now** in another tab; the highlighted queue should not lose focus mid-window.)

- [ ] **Step 7: Stop the dev server**

```bash
# Ctrl-C the npm run dev process; if the worker orphaned, kill stray tsx:
pkill -f "tsx watch" || true
```

- [ ] **Step 8: Record the result**

If all steps pass, the feature is verified. If any step fails, file the specific failure and return to the relevant task — do not mark the plan complete.

---

## Self-Review

**Spec coverage:**
- Keyboard nav (j/k/Enter/e/Esc), inert-in-textarea → Task 3 (QueueProvider keydown) + Task 7 verification. ✓
- Optimistic collapse + auto-advance → Task 6 (collapsed render, `terminal`) + Task 3 (`advanceHighlight` on Enter). ✓
- 3s deferred-undo send (hold `approveResponse`) → Task 2 (controller), Task 4 (hook), Task 6 (wiring). ✓
- Pre-filled path = Mark sent, no timer → Task 6 `primary()`. ✓
- AutoRefresh suppression while busy, AutoRefresh stays generic → Task 3 (internal `active && !busy`) + Task 5 (page wiring, awaiting branch keeps plain AutoRefresh). ✓
- Visual hierarchy (dominant green primary, muted secondary, highlight ring) → Task 6. ✓
- Error handling (re-expand + inline error) → Task 6 (`error` phase render). ✓
- `QueueActivityContext` busy = highlight engaged OR pending timer → Task 3 (`busy = highlightedId !== null || pending.size > 0`). ✓
- Testing: unit tests for advance logic + deferred-send with fake timers; manual Playwright → Tasks 1, 2, 7. ✓

**Placeholder scan:** No placeholders. Auto-advance is implemented concretely in Task 3's `Enter` branch (`queueMicrotask` + `advanceHighlight`); `advanceHighlight` is exported by Task 1 and excludes the current card structurally (search starts at `start + 1`), so the just-actioned card is skipped even before its `isTerminal` re-registers.

**Type consistency:** `reply_id: number` everywhere; `CardHandlers`/`QueueApi` names match between Task 3 (definition) and Task 6 (consumption); `SendState` phases (`idle`/`sending`/`sent`/`error`) match between Task 2, Task 4, and Task 6. `RepliesQueue` prop shape (`replies`, `active`) matches between Task 5 (definition) and page wiring.
