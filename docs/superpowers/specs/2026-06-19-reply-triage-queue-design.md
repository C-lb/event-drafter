# Reply Triage Queue — Design

**Date:** 2026-06-19
**Status:** Approved (design), pending implementation plan
**Scope:** `/replies` page UX only. No database, schema, or worker changes.

## Problem

`/replies` is the operator's daily driver: read each incoming RSVP, optionally
edit the drafted response, approve-and-send. Today each reply is a card with
4–6 equal-weight gray (`text-xs`) buttons. Clearing one means: mouse over →
read → maybe edit → hunt for the green button → click → wait for a silent full
`router.refresh()` → repeat. For a handful of replies it's fine; after an event
blast (20–30 replies) it's a mouse grind. And because actions give no feedback
(the list just re-renders a beat later), the operator is never sure a send
actually happened.

## Goals

1. Clear a queue of replies fast, primarily from the keyboard.
2. Make the primary action (`Approve & send`) visually dominant.
3. Give immediate feedback on every action.
4. Make `Approve & send` recoverable — it hits WhatsApp, which has no unsend.

## Non-goals (YAGNI)

- Bulk multi-select / "approve N" (deferred — natural fast-follow).
- Number-key classification shortcuts.
- Any change to the send pipeline, job kinds, schema, or LLM prompts.
- A general toast/notification system (the collapsed confirmation row *is* the
  feedback; see below).

## Key constraint: auto-refresh

`/replies` renders `<AutoRefresh active={inFlight} />`, which triggers
`router.refresh()` every 1.5s **while `active` is true** — and `active` is
`inFlight` (a `check_replies` job queued or running). It is not a continuous
poll, but `maybeEnqueueAutoReplyCheck()` runs on every page load and can kick a
check job whenever the last one is >30min stale, so a refresh burst can overlap
an active triage session. A refresh re-renders the server-fetched list, which
would destroy (a) keyboard focus/highlight and (b) any in-flight optimistic
state or undo timer. **The spine of this design is suppressing that refresh
while the operator is actively working the queue, and resuming when idle.**

## How the existing send path works (grounds the undo)

`approveResponse(reply_id)` (`packages/web/app/events/[id]/actions.ts:403`):

```
tx:
  replies.response_status := 'approved', response_approved_at := now
  jobs.insert({ kind: 'send_response', payload: { reply_id } })
```

The actual WhatsApp send is the `send_response` worker job, picked up ~1s later
— **not** the server action itself. Therefore a true "undo" needs no recall: we
simply **defer the `approveResponse` call** by 5s on the client. If the operator
undoes within the window, the action is never called and nothing is ever
enqueued. This is why the feature needs zero server changes.

Pre-filled cards (`response_status === 'prefilled'`) are a different flow: the
draft was already pushed into WhatsApp Web and the human sends it there. Their
primary action is `markResponseSent` (no timer — the send already happened by
the human's hand).

## Architecture

All client-side. Five units, each single-purpose and independently testable.

### 1. `QueueActivityContext`
A React context exposing a `busy` boolean and a setter. `busy` is true while:
- a card is highlighted (the operator is engaged), **or**
- any card has a pending deferred-send timer.

`AutoRefresh` is moved inside the provider and consumes this context, gating its
own effect on `active && !busy` (i.e. it still polls when a check job is in
flight, but not while the operator is engaged in the queue). Because the page is
a Server Component and `busy` is client state, the AND must happen in the client
`AutoRefresh`/`RepliesQueue` layer, not in `page.tsx` — the page keeps passing
`active={inFlight}` unchanged. Polling resumes ~1s after `busy` goes false.

### 2. `useQueueNavigation(orderedIds: string[])`
Owns `highlightedId` and a single global `keydown` listener.

| Key | Action |
|-----|--------|
| `j` / `ArrowDown` | highlight next card |
| `k` / `ArrowUp` | highlight previous card |
| `Enter` | trigger the highlighted card's **primary** action |
| `e` | focus the highlighted card's draft textarea |
| `Esc` | blur back out to the list |

Keys are **inert whenever an `<input>` or `<textarea>` is focused** (so typing a
draft is normal), with the sole exception of `Esc` (blurs the field). Exposes
`{ highlightedId, advance() }`. `advance()` moves the highlight to the next card
not already in a terminal state — **pure function, unit-tested**.

### 3. `useDeferredSend({ onSend, delayMs: 5000 })`
The Gmail-undo state machine:

```
idle --send()--> sending(timer) --(5s elapses)--> sent
                      |                              |
                   undo()                         onSend() throws
                      v                              v
                    idle <-------------------------error
```

- `send()` collapses the card and starts the timer; registers `busy`.
- `undo()` clears the timer and returns to `idle`; nothing was sent.
- on timer fire, calls `onSend` (the real `approveResponse`); → `sent`.
- if `onSend` throws → `error` (card re-expands with retry; see Errors).

Unit-tested with fake timers: undo-cancels-before-fire, fire-after-timeout,
onSend-throws → error.

### 4. `ReplyCard` (reworked)
Consumes both hooks. Two render modes:

- **Expanded** (default): reply text + draft `<textarea>`, a visually dominant
  solid-green `Approve & send`, and de-emphasized secondary actions (`Skip`,
  `↻ Regenerate`, `Mark resolved`, `Mark it as`). When highlighted, a left
  accent ring/border.
- **Collapsed** (terminal local state): a single line.
  - sending: `✓ sending to {name}…  [undo]`
  - sent: `✓ sent to {name}`
  - skipped: `↷ skipped`
  - resolved: `✓ resolved`
  Undo (only present during the 5s window) re-expands the card.

`Enter` maps to the status-aware primary action:
- normal card → deferred `Approve & send`
- `prefilled` card → `Mark sent` (no timer)

### 5. `RepliesQueue` (new client wrapper)
Sits between the server `page.tsx` and the cards. Receives the server-fetched
rows, derives the ordered id list, provides `QueueActivityContext` and the nav
context, renders the list of `ReplyCard`s. `page.tsx` stays a server component;
filter tabs and data fetching are unchanged.

## Data flow (Enter on a highlighted card)

```
Enter
 → ReplyCard.useDeferredSend.send()
    → collapse to "✓ sending… undo"
    → busy := true   (AutoRefresh pauses)
    → start 5s timer
 → useQueueNavigation.advance()  (highlight jumps to next card)
 ... operator may hit undo here → timer cleared, card re-expands, busy recomputed
 → 5s elapses
    → approveResponse({ reply_id })   (enqueues send_response job)
    → collapse to "✓ sent"
    → busy recomputed; if no other engagement, AutoRefresh resumes ~1s later
```

## Error handling

If the deferred `approveResponse` (or `skipResponse`/`setReplyResolved`/
`markResponseSent`) throws:
- the card re-expands from collapsed,
- shows an inline red `Send failed — retry` with a retry button,
- stays in the queue; the highlight does not strand on a vanished card.

Because the action is deferred 5s, a failure surfaces ~5s after `Enter`, while
the operator may already be on a later card — the re-expanded error card is
their signal to come back.

## Testing

- **Unit:** `advance()` (highlight skips terminal cards, wraps/stops at ends);
  `useDeferredSend` reducer with fake timers (undo cancels, fires after timeout,
  onSend-throws → error). These two hold the only real logic.
- **Manual:** Playwright MCP pass on the dev server — `j`/`k` highlight moves,
  `Enter` collapses + advances, `undo` within 5s prevents the send (assert no
  `send_response` job row appears), `e`/`Esc` focus round-trip, typing in the
  textarea does not trigger nav keys.
- Presentational changes (hierarchy, collapsed row) verified visually.

## Risk

Low. Reuses every existing server action unchanged; the change is a UI layer
over logic that already works and is already verified. The only subtle piece is
the auto-refresh suspension, which is contained to `QueueActivityContext` +
`AutoRefresh`.
