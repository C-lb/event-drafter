# Stranded-send recovery design

Date: 2026-06-30
Status: approved (design), pending implementation

## Problem

The worker delivers WhatsApp messages serially with a per-record single-send claim
(`UPDATE ... SET status='sending' WHERE status='approved'`). If the worker is cut off
mid-batch:

- **Approved + still queued** send jobs resume automatically on the next worker start
  (the poll loop just keeps draining the queue). No change needed, no prompt.
- **The message that was actively in flight at the cut** is deliberately frozen. Both the
  poller stuck-job sweep (`packages/worker/src/poller.ts`) and the soft restart
  (`packages/worker/src/restart.ts`) exclude `SEND_KINDS` from auto-requeue, because the
  worker cannot know whether that message already left WhatsApp. So it never auto-resends.

Today those frozen records are **invisible and unrescuable through the normal UI**:
- An invite stuck at `status='sending'` is never resurfaced; its send job stays stuck at
  `running` forever; and the normal Approve button is a no-op on `sending`
  (`approveDraft` excludes `['sending','approved','prefilled','sent']`).
- A `prefilled` record (typed into WhatsApp, send unconfirmed) has only the buried per-row
  `markSent` / `reprefill` actions.

We add a recovery surface that requires an explicit human decision per stranded message,
preserving the single-send guarantee (the worker never auto-resends an ambiguous message).

## Scope

Cover all three send record types (the claim/strand bug is identical for each):

| Record    | Table        | Status column     | Send job kind     | Claim fn                |
|-----------|--------------|-------------------|-------------------|-------------------------|
| invite    | `invites`    | `status`          | `send_message`    | `claimInviteForSend`    |
| follow-up | `follow_ups` | `status`          | `send_follow_up`  | `claimFollowUpForSend`  |
| reply     | `replies`    | `response_status` | `send_response`   | `claimResponseForSend`  |

### What counts as "stranded" (needs a decision)

For each record type:
- `sending` — always stranded (claimed, never confirmed). **Exclude the single record the
  worker is actively sending right now** when the worker is connected (the `sends.current`
  target already computed in `/api/worker/state`), so the live in-flight send never flickers
  into the list.
- `prefilled` (`replies`: `response_status='prefilled'`) — **only when auto-send is on**
  (`getSetting('auto_send_enabled') === true`). In manual-send mode `prefilled` is the
  normal "operator presses send in WhatsApp" worklist and must not be flagged.

`approved` (still queued) is never flagged — it auto-resumes.

## Actions

Per row, two choices; nothing sends until clicked:

- **It was sent** → mark the record `sent` (reuse `markSent` for invites; add equivalents for
  follow-ups and replies).
- **Resend** → reset to `approved`, clear `prefilled_at`/`sent_at`, enqueue a fresh send job
  (reuse the existing `reprefill` pattern for invites; equivalents for the other two). The
  resend re-runs the normal claim → send path, so single-send still holds.

Either action also resolves the orphaned stuck send job: set the record's stuck `running`
send job to `failed` with `last_error = 'superseded by operator recovery'` so it stops
showing as in-flight.

### Bulk action (prefilled group)

A single **Resend all prefilled** button re-approves and re-enqueues a send for every
flagged `prefilled` record in the list (across the three types). The more-ambiguous
`sending` group stays per-row only (no bulk), since those are the records most likely to
have already gone out.

## Surfacing

- `/api/worker/state` gains a cheap `limboCount`. The worker status indicator
  (`WorkerStatus.tsx`) shows an amber "N messages need a decision" affordance on the pill and
  in the offline banner when `limboCount > 0`, linking to `/status`.
- A new **Messages in limbo** section on the `/status` page lists stranded records grouped by
  event, each row: recipient name, which state it was caught in (`mid-send` / `prefilled`),
  and the two action buttons. The prefilled group carries the bulk Resend-all button.

## Components / boundaries

- `packages/web/lib/limbo.ts` — pure. Given the three fetched record sets, the auto-send
  flag, and the active in-flight send target, returns the typed limbo list + counts.
  Unit-tested (selection, active-send exclusion, prefilled-only-when-auto-send gating).
- `packages/web/app/status/limbo-actions.ts` — server actions: `listLimbo()` (DB reads →
  `lib/limbo.ts`), `recoverMarkSent({type,id})`, `recoverResend({type,id})`,
  `recoverResendAllPrefilled()`. Each resend/mark-sent also fails the orphaned send job.
- `packages/web/app/status/MessagesInLimbo.tsx` — client section + row component with the
  four button states + loading + confirm feedback (house anti-vibecode rules).
- `/api/worker/state` route: add `limboCount` via a count query (reuses the same predicate).

## Testing

- Unit: `packages/web/lib/limbo.test.ts` — flag/exclude logic, active-send exclusion,
  prefilled gating by auto-send flag, grouping.
- Integration (worker test harness, temp DB): the three mutations — mark-sent, single
  resend, bulk resend-all-prefilled — assert record status transitions, a new send job is
  enqueued on resend, and the orphaned stuck `running` send job is failed. Follow the
  existing `packages/worker/test/*.test.ts` temp-DB pattern.

## Non-goals

- No change to the worker's auto-resume of queued sends.
- No bulk action on the `sending` group (blanket double-send risk).
- No new job kinds; reuse `send_message` / `send_follow_up` / `send_response`.
