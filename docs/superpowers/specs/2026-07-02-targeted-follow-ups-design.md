# Targeted follow-ups — design

Date: 2026-07-02
Status: approved (pending spec review)

## Summary

An operator-driven flow to send a targeted WhatsApp follow-up to hand-picked
invitees of an event. The operator picks an event, selects which invitees to
follow up with, sets each person's logistics (food preference, chauffeur,
parking coupon, our bus), then generates drafts one of three ways: a general
reminder, a logistics-tailored message, or a merge-field template. Generated
drafts land in the existing `/follow-ups` queue, where the current
approve / edit / skip / send-over-WhatsApp machinery takes over unchanged.

This is separate from the existing **automatic** follow-up system (the worker
auto-drafts a gentle follow-up for non-responders after N days). That system is
untouched. Both write to the same `follow_ups` table and share the same review
and send pipeline.

## Goals

- Pick an event, then select any subset of its invitees ("a few" or "all").
- Capture per-contact-per-event logistics: chauffeured, parking coupon, our bus
  (on/off), and food preference (short free text). Persist them so they are set
  once and reused for later blasts.
- Three compose modes after selection:
  1. **General reminder** — LLM draft, name-personalized, no logistics.
  2. **Tailored** — LLM draft that weaves in only each contact's active logistics.
  3. **Template** — write-your-own text with merge fields, filled deterministically
     per contact. Optionally saved to a reusable library and reloaded later.
- Drafts flow into `/follow-ups` for the existing approve/send flow.

## Non-goals

- No new send channel. Sends stay WhatsApp via the existing prefill pipeline.
- No email sending.
- No change to the automatic non-responder follow-up job.
- No new approve/send UI — reuse `/follow-ups`.
- No per-toggle scheduling or per-event configurable toggle phrasing in the MVP
  (toggle expansion phrases are fixed defaults; see Merge fields).

## Data model

### `invites` — new columns (per contact, per event)

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `chauffeured` | boolean | false | We drive them to the venue |
| `parking_coupon` | boolean | false | They get a parking coupon |
| `takes_bus` | boolean | false | They ride our shuttle |
| `food_pref` | text | null | Short free text, e.g. "vegetarian", "no shellfish" |

Added via a drizzle migration. Boolean columns are NOT NULL with a default of
false; `food_pref` is nullable.

### `message_templates` — new table (reusable library)

| Column | Type | Notes |
|--------|------|-------|
| `id` | integer PK | auto-increment |
| `name` | text NOT NULL | Falls back to the first line of the body (trimmed, capped) if the operator leaves it blank |
| `body` | text NOT NULL | Merge-field text |
| `created_at` | timestamp_ms | default now |
| `updated_at` | timestamp_ms | default now |

### `follow_ups` — reused, no change

Targeted follow-ups insert rows with `status = 'drafted'`, exactly like the
automatic generator. The table already allows multiple rows per invite, so a
contact can receive several follow-ups over time.

## Merge fields (template mode)

Deterministic substitution, no LLM. Supported tokens:

| Token | Expands to |
|-------|-----------|
| `{first_name}` | contact first name |
| `{last_name}` | contact last name (empty if none) |
| `{event_name}` | event name |
| `{event_date}` | event date, formatted |
| `{venue}` | event venue (empty if none) |
| `{food_pref}` | the invite's `food_pref` text (empty if none) |
| `{parking}` | fixed phrase when `parking_coupon` is on, else empty |
| `{bus}` | fixed phrase when `takes_bus` is on, else empty |
| `{chauffeur}` | fixed phrase when `chauffeured` is on, else empty |

Default toggle phrases (MVP, hardcoded in core):
- `{parking}` → "We'll send you a parking coupon closer to the date."
- `{bus}` → "You're on our shuttle, we'll share pickup details soon."
- `{chauffeur}` → "We'll arrange a car to bring you to the venue."

After substitution the renderer collapses runs of blank lines and stray double
spaces left by empty tokens, and strips any em dash (house rule). An unknown
token is left verbatim so a typo is visible rather than silently dropped.

Rendering lives in `packages/core` (pure function, unit tested) so both the web
server action and any future consumer share one implementation.

## Draft generation

### LLM modes (general, tailored) — worker job

New job kind `generate_targeted_follow_ups`. Payload:

```
{ event_id: number, invite_ids: number[], mode: 'general' | 'tailored' }
```

The worker, per invite: loads event + contact + invite, builds a prompt, calls
`complete()` (Claude, same client as today), sanitizes voice, inserts a
`follow_ups` row with `status = 'drafted'`. It reports progress on the job row.
This matches the existing `generate-follow-ups.ts` job structure and keeps the
Anthropic key in the worker process.

Prompt: extend the existing follow-up prompt input with an optional `logistics`
block. In `general` mode the block is omitted. In `tailored` mode it lists only
the active facts (food_pref text if present, plus any on-toggles), and the prompt
instructs the model to weave in only those that apply, briefly and naturally,
matching the global style guide. No sign-off, same voice rules as today.

Unlike the automatic generator, this job does NOT filter by reply status or
delay — it drafts exactly the `invite_ids` it is given.

### Template mode — inline server action

Deterministic merge needs no LLM, so it runs synchronously in the web server
action: render the body per selected invite, insert `follow_ups` rows
(`status = 'drafted'`), optionally save the template. Returns immediately.

## Server actions (web)

- `listInvitesForFollowUp(event_id)` — invitees for the event with contact,
  logistics, RSVP, and whether a reply exists (for display only; all are
  selectable).
- `saveInviteLogistics({ invite_id, chauffeured, parking_coupon, takes_bus, food_pref })`
  — persist logistics to the invite. Called on edit, independent of drafting.
- `generateTargetedFollowUps({ event_id, invite_ids, mode })` — validate, enqueue
  the worker job (LLM modes). Returns `{ ok, count }`.
- `createTemplateFollowUps({ event_id, invite_ids, body, save_as_template?, template_name? })`
  — render merge per invite, insert `follow_ups` rows, optionally save template.
  Returns `{ ok, count }`.
- `listTemplates()`, `saveTemplate({ name, body })`, `deleteTemplate(id)` — library CRUD.

All validate input with zod and return `{ ok: true, ... } | { ok: false, error }`,
matching existing action conventions. Event/invitee listing reuses existing
helpers where possible.

## UI

Route: **`/events/[id]/follow-up`** — the compose screen, event-scoped and
consistent with the existing `/events/[id]/pick-contacts`.

Entry points:
- A "Follow up" action on the event page → `/events/[id]/follow-up`.
- A "New follow-up" button on `/follow-ups` → a lightweight event picker that
  routes to `/events/[id]/follow-up`.

Compose screen structure:
1. **Invitee table** — the event's invitees. Row select reusing the
   `pick-contacts` interaction (search, shift-click range, "select all"). Inline
   columns per row: three toggles + a food-pref text input. Editing a row's
   logistics calls `saveInviteLogistics` (debounced/on-blur), persisting to the
   invite. A "picked" counter.
2. **Compose panel** — three tabs: General / Tailored / Template.
   - General & Tailored: a "Generate drafts" button → `generateTargetedFollowUps`
     → toast + redirect to `/follow-ups`.
   - Template: a textarea with a merge-field hint, a "Load template" picker
     (from `listTemplates`), a "Save as template" checkbox + optional name, and
     a "Generate drafts" button → `createTemplateFollowUps` → toast + redirect.
3. On success, redirect to `/follow-ups` where the drafts appear as `drafted`.

UI follows the existing house system (anti-vibecode): `card`, `badge`, `btn`,
`field`, `eyebrow` classes; one accent; sentence-case; inline feedback banners
like the rest of the app; no em dashes.

## Testing

- **core** — merge renderer: each token, toggle on vs off, `food_pref` present vs
  empty, blank-line/double-space collapse, unknown-token passthrough, em-dash
  strip. Migration adds the columns and table.
- **worker** — `generate_targeted_follow_ups` job: inserts one `drafted`
  follow_up per given invite for both modes; tailored prompt includes only active
  logistics; ignores reply/delay filtering.
- **web** — `saveInviteLogistics` persists; `createTemplateFollowUps` inserts N
  rows and (when flagged) saves a template; `generateTargetedFollowUps` enqueues a
  job with the correct payload; template CRUD round-trips. Integration test over
  the create-template path end to end (render → rows in DB) to catch a client/
  server merge-token drift.

## Assumptions

- Targets are existing invitees only (rows in `invites` for the event). Adding
  new people to an event stays the existing `pick-contacts` flow; this feature
  does not create invites.
- Toggle expansion phrases are fixed defaults in the MVP. Making them
  event-configurable is a later follow-up.
- Saved templates are global (not per-event); a template can be reused across
  events because merge fields resolve against whichever event/contact it renders for.
