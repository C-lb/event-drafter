# Clear yes/no → approve-row + roster — Design

**Date:** 2026-06-20
**Status:** Designed, NOT built (captured for a later plan). Approved direction; user asked to wrap up before implementation.
**Scope:** `/replies` page rendering + (none) — no worker change after the approval amendment.

## Problem

Every reply — including unambiguous yes/no — currently shows as a full triage
card in `/replies`. Clear RSVPs don't need a judgment card; they clutter the
queue. The operator wants the queue to surface only the calls that need a
decision, and to see clear RSVPs as a simple per-event roster of who's coming.

## Decisions (locked)

- **Partition is purely on classification.**
  - **Cards** (the existing keyboard `RepliesQueue`): unclassified/pending,
    `maybe`, or `unclear` — the replies needing the operator's judgment.
  - **Roster** (new, below the cards, grouped by event): `yes` and `no`,
    rendered as two short name lists per event — **Coming** (yes) and
    **Not coming** (no), with counts. Includes resolved ones. No card.
- **Yes and No both get a drafted confirmation reply** (already produced by
  `classify_reply`).
- **Approval stays in the loop (amendment).** The operator approves before any
  confirmation is sent — there is **no auto-send**. Therefore a clear yes/no
  whose confirmation is still unsent is shown as a **compact approve-row**
  (contact · yes/no · draft preview · "Approve & send"), not a full card and
  not yet in the roster. Once approved + sent, it drops into the event roster.
- **Reaction-sourced yes/no** stay as built: roster only, no draft, nothing to
  send (reactions never draft).

## Effective flow

```
reply classified yes/no (has draft, unsent)  -> compact approve-row
   operator clicks Approve & send -> send_response -> sent
   -> moves to event roster (Coming / Not coming)
reply classified maybe/unclear/pending       -> full judgment card (RepliesQueue)
reaction yes/no (no draft)                    -> straight to roster
"they replied again" (classification reset)   -> back to a full card
```

## Architecture (when built)

- No worker change (the earlier auto-approve/auto-send idea is dropped — the
  operator approves each send).
- `replies/page.tsx`: partition `listAllReplies` (fetched incl. resolved) into
  three buckets — judgment cards, unsent yes/no approve-rows, and sent/handled
  yes/no roster entries.
- New `RsvpRoster` component: groups roster entries by `event_name`, splits
  Coming/Not-coming by `classification`, renders names + counts. Read-only.
- A compact approve-row component (or a `compact` mode on the existing card)
  for unsent yes/no — reuses `approveResponse`.
- Existing `RepliesQueue`/`ReplyCard` keep handling the judgment cards. Filter
  chips stay.

## Out of scope (YAGNI)

- Auto-sending yes/no without approval (explicitly rejected by the operator).
- Per-event-page roster (this is the global `/replies` roster; the event page
  already has `RsvpSummary` counts).
- Un-rostering on reaction removal.

## Open question for the plan

- Exact visual of the compact approve-row vs. the roster (mockup during
  planning).
- Whether the "Show resolved" toggle still applies to the cards only (roster
  always shows yes/no regardless of resolved).
