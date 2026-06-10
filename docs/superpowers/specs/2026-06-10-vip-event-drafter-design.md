# VIP Event Drafter — Design Spec

**Date:** 2026-06-10
**Status:** Approved (brainstorming phase complete; implementation plan pending)
**Owner:** caleb (david.chin@wahspark.com)

---

## 1. Purpose

A local, single-user tool that helps the operator personally invite ~30–100 high-net-worth contacts per event to recurring functions (2–4 events/month) via WhatsApp, then track and respond to replies. Claude drafts each personalized message and each response; the human always commits the send.

The product lives at the intersection of a CRM-lite, a queue manager, and a drafting assistant. It is **not** a marketing automation platform — every outbound message is reviewed and manually sent.

## 2. Constraints & non-goals

**Hard constraints**
- WhatsApp transport is **WhatsApp Web on Chrome (Playwright-driven Chromium)** — the WhatsApp Business Cloud API is rejected as a transport. ToS risk is accepted; mitigated by paste-don't-send (see §5.1).
- Runs **locally on the operator's Mac only**. No public hosting, no shared access.
- **Single user** (the operator). No multi-tenant, no team auth.

**Non-goals**
- No cold outreach to unknown contacts (every contact is a known relationship).
- No mass-send / blast functionality.
- No marketing-analytics dashboards (open-rates, A/B tests, etc.).
- No mobile UI. Desktop browser only.
- No deployment story. No CI/CD beyond local lint/test scripts.
- No autonomous send. Claude never clicks WhatsApp's send button.

## 3. Architecture

### 3.1 Process topology

Two long-lived processes sharing one SQLite database.

```
┌─────────────────┐     reads/writes      ┌─────────────────────────┐
│   web (Next.js) │ ←──── SQLite ────→    │   worker (Node, long-   │
│   localhost:3000│       app.db          │   lived, owns Playwright│
│   dashboard UI  │                       │   + cron + Claude API   │
└─────────────────┘                       │   + Google APIs)        │
                                          └─────────────────────────┘
```

The UI **never** invokes Playwright, the Claude API, or Google APIs directly. It writes intent into the `jobs` table; the worker polls, executes, writes results. This means either process can crash and restart without losing queued work, and the UI stays responsive (just SQLite reads).

Both processes are started together for development via `concurrently` in the root `package.json`. For "always-on" operation, an optional `launchd` plist is offered during setup to auto-start the worker on user login.

### 3.2 Repo layout

```
vip-event-drafter/
├── packages/
│   ├── web/                  # Next.js 16 App Router
│   │   ├── app/              # dashboard routes: /events, /queue, /replies, /contacts, /status
│   │   ├── app/api/          # API routes — thin wrappers over SQLite + job enqueue
│   │   └── lib/db.ts         # re-export of shared db client
│   ├── worker/               # long-lived Node process
│   │   ├── src/index.ts      # job poller + cron scheduler entry
│   │   ├── src/jobs/         # send_message, check_replies, classify_reply,
│   │   │                     # draft_response, generate_follow_up
│   │   ├── src/wa/           # Playwright WA Web driver + selectors.ts
│   │   ├── src/sources/      # Google Sheets + Gmail clients
│   │   └── src/llm/          # Claude API client + prompt builders
│   └── core/                 # shared: types, Drizzle schema, migrations, db client
├── data/
│   ├── app.db                # SQLite (gitignored)
│   └── wa-profile/           # Playwright user-data-dir; persistent WA Web session
├── docs/superpowers/specs/   # design + implementation plans (this file)
├── .env                      # API keys, OAuth creds
└── package.json              # concurrently web + worker
```

### 3.3 Stack

| Concern | Choice | Why |
|---|---|---|
| UI framework | Next.js 16 (App Router) + React 19 | Operator already comfortable; RSC fits dashboard read patterns |
| DB | SQLite via `better-sqlite3` | One file, no DB server, easy backup |
| ORM | Drizzle | TypeScript-native, codegen migrations, plays well in both processes |
| Browser automation | Playwright (Chromium, persistent user-data-dir, headed) | Most reliable WA Web driver; headed lets operator watch |
| UI components | Tailwind + shadcn/ui | Sensible defaults, low setup cost |
| LLM | Claude Sonnet 4.6 via `@anthropic-ai/sdk` | Personal voice matters (Haiku too generic); Opus overkill at this volume |
| Prompt caching | Anthropic ephemeral cache on per-event system prompt | ~90% input cost reduction across N contacts in one event |
| Cron | `node-cron` in worker process | Single process, no extra infra |
| Dev runner | `concurrently` | Both processes from one `npm run dev` |

## 4. Data model

All tables live in SQLite (`data/app.db`). Schema versioned via Drizzle migrations in `packages/core/`.

### 4.1 Tables

#### `contacts` — one row per person
```
id (pk), full_name, preferred_name, phone_e164, email?,
personal_note,           -- per-contact LLM hook ("recently exited fintech")
interests,               -- free text, fed to LLM
relationship_notes,      -- accumulates over time; edited in dashboard
sheet_row_hash,          -- for Sheet re-sync change detection
created_at, updated_at
```

#### `events` — one row per event
```
id (pk), name, event_date, venue,
edm_subject, edm_body,   -- pulled from Gmail once
gmail_message_id,        -- provenance
status,                  -- draft | drafting | sending | closed
created_at
```

#### `invites` — one row per (event × contact); the workhorse
```
id (pk), event_id (fk), contact_id (fk),
draft_text, draft_generated_at,
approved_at, sent_at,
status,                  -- pending | drafted | approved | sent | skipped | failed
rsvp,                    -- yes | no | maybe | none (derived from latest classified reply)
attended,                -- boolean, manually set post-event
attended_notes,          -- "great catch-up at the bar" — informs next event
generation_meta,         -- json: model, tokens, cache hit, prompt version
UNIQUE (event_id, contact_id)
```

#### `replies` — 0..n per invite
```
id (pk), invite_id (fk),
wa_message_text, wa_sent_at, detected_at,
classification,          -- yes | no | maybe | unclear
classification_confidence, classification_summary,
response_draft, response_approved_at, response_sent_at, response_status
```

#### `follow_ups` — 0..n per invite (day-3 nudges)
```
id (pk), invite_id (fk),
draft_text, generated_at,
approved_at, sent_at, status
```

#### `jobs` — worker queue
```
id (pk), kind,            -- send_message | check_replies | classify_reply |
                          -- draft_response | generate_follow_up
payload,                 -- json
status,                  -- queued | running | succeeded | failed
attempts, last_error,
run_after,               -- for scheduled jobs (cron sets run_after = today 6pm)
created_at, started_at, finished_at
```

#### `wa_chat_cursors` — watermark for reply scraping
```
contact_id (pk, fk), last_seen_wa_sent_at, updated_at
```
Tracks the timestamp of the most recent WA message we've persisted per contact, so reply scans only ingest new content.

### 4.2 Source-of-truth policy

The Google Sheet is **seed only**. On import, contacts copy into SQLite. From that point forward, the **dashboard is canonical** for `personal_note`, `interests`, `relationship_notes`, `attended`, and `attended_notes`. A "Re-sync from Sheet" button:
- Adds new contacts from Sheet rows not yet in DB.
- Flags Sheet rows whose `sheet_row_hash` has changed since last sync, presenting a per-field merge view.
- Never silently overwrites dashboard edits.

Rationale: writes to attendance and notes need a single home. Two-way sync over a Sheet is fragile; dashboard-as-canonical removes the ambiguity.

## 5. Pipelines

### 5.1 Drafting & sending invites

```
operator: "Create event from Gmail" → pick EDM by message-id or from inbox list
   ↓
worker: Gmail API → pull EDM → insert events row (status=draft)
   ↓
operator (dashboard): filter contacts (by interests, prior attendance) → select for event
   ↓
operator clicks "Generate drafts"
   ↓
worker, per (event, contact):
   • build prompt: cached system (style guide + event EDM)
     + user (contact name, hook, interests, last 1-2 attended events)
   • call Claude Sonnet 4.6
   • insert invites row (draft_text, status=drafted)
   ↓
dashboard queue view: one card per contact — name, hook used, draft, [Edit][Approve][Skip]
   ↓
operator approves drafts (singly or batch)
   ↓
worker picks up send_message jobs at jittered intervals (15-45s, max 30/hr):
   • Playwright nav to https://web.whatsapp.com/send?phone={e164}&text={url-encoded}
   • WA Web opens chat with text PRE-FILLED in input box
   • worker waits — DOES NOT click send
   • dashboard shows "draft loaded — confirm in WA Web, then click 'Mark sent'"
   ↓
operator clicks WA's send button manually, then "Mark sent" in dashboard
   ↓
worker: invites.sent_at = now, status = sent
```

**The paste-don't-send invariant.** Playwright only navigates to the WA send-URL and lets WA's own page pre-fill the input. The worker does not click send, does not press Enter, does not touch the input after pre-fill. The human always commits the send. This keeps the automation footprint indistinguishable from the operator typing `wa.me/...` URLs by hand.

If WA changes the send-URL prefill behavior (it has changed before), the worker falls back to typing into the input box (slightly higher ToS exposure); this fallback is gated behind a dashboard warning the operator must dismiss.

### 5.2 Reply check & response drafting (6pm cron)

```
6pm cron fires check_replies job
   ↓
worker: Playwright opens WA Web (authenticated via persistent profile)
   ↓
for each invite where status=sent AND sent_at < 14 days ago:
   • nav to chat
   • read messages newer than wa_chat_cursor[contact_id]
   • for each new inbound message: insert replies row
   • update cursor
   ↓
for each new reply row:
   • queue classify_reply job
     - Claude: {classification, confidence, summary, response_draft}
   • persist classification + response_draft
   • update invites.rsvp from latest classification
   ↓
dashboard "Replies" view sorted by event:
   ✅ YES (15)  ❌ NO (3)  🤔 MAYBE (5)  ❓ UNCLEAR (2)
   per row: contact, summary, original text, draft response, [Edit][Approve][Skip]
   ↓
operator approves responses → same paste-don't-send flow as 5.1
```

**Per-chat cursor.** Tracked in the `wa_chat_cursors` table (§4.1). Cursor advances only after the reply row is durably persisted, so a worker crash mid-scan is safe to retry.

### 5.3 Day-3 nudge for non-responders

```
daily 6pm cron also fires generate_follow_ups job
   ↓
find invites where sent_at <= 3 days ago AND no replies recorded
   ↓
for each: Claude drafts soft follow-up
   • different tone from initial; references original send
   • prompt template: "floating this back up" style
   ↓
insert follow_ups row, surface in dashboard "Follow-ups ready" tab
   ↓
operator reviews/approves/skips → same paste-don't-send flow
```

### 5.4 Cross-cutting

**Prompt structure (cost + quality).** Per event, system prompt contains:
- Operator's voice/style guide (free text, set during first-run; can be edited per-event)
- The event EDM body
- Generic drafting rules (length, tone, do's/don'ts)

System prompt marked with `cache_control: { type: "ephemeral" }`. User message per contact contains only `{name, preferred_name, personal_note, interests, attendance_history[]}`. After the first call in a batch, every subsequent call hits the cache → ~90% input cost reduction.

**Rate limiting & jitter.**
- Outbound sends: 15–45s random gap, max 30/hour. Hard-stop on the 31st send/hour with a dashboard banner ("resume tomorrow or override").
- Reply scrapes: 2–5s gap between chat navigations.
- Rationale: looks like a human reading and typing, not a bot.

## 6. Scheduling

`node-cron` schedule in the worker:

| Time | Job |
|---|---|
| 06:00 PM daily | `check_replies` + `generate_follow_ups` |
| 12:00 PM daily | catch-up `check_replies` (covers laptop-asleep-at-6pm case) |
| Worker startup | missed-run check: if no `check_replies` job created for today, create + run |

**Laptop sleep mitigation.** A pure `node-cron` won't fire while the Mac is asleep. The missed-run check on worker startup and the noon catch-up cover the common cases. The dashboard header shows **"Last reply scan: N hours ago"** in green/amber/red so the operator can see staleness at a glance. An optional `launchd` plist (offered in first-run setup) auto-starts the worker on user login for operators who want bulletproof always-on behavior.

## 7. Fragility & error handling

### 7.1 Fragility budget

WhatsApp Web is **not a contract**. Expected breakage rate: **2–4 selector changes per year**. Mitigation:
- All DOM selectors isolated in `packages/worker/src/wa/selectors.ts`. Named exports, one source of truth.
- A startup smoke test exercises a known interaction sequence (open WA → find chat list → confirm logged in). If selectors fail, the worker refuses to start sending and surfaces a dashboard banner pointing at the file to fix.
- Selector failures log structured errors (`selector_name`, `expected_role`, `dom_snapshot`) for fast diagnosis.

### 7.2 Failure modes

| Failure | Detection | Response |
|---|---|---|
| WA QR expired / logged out | Playwright sees login screen | Dashboard banner: "Scan QR" → button opens headed Playwright for the operator to scan |
| Contact not on WhatsApp | `wa.me/{phone}` returns invalid-number page | Mark invite `failed` with reason; operator fixes number, retries |
| WA selector mismatch | Startup smoke test or job-time exception | Outbound paused; banner explains; resume gated on operator confirmation |
| Claude API 429 / 5xx | SDK throws | 3× exponential backoff retry; final fail → mark draft `failed`; "Regenerate" button |
| Google OAuth expired | API 401 | Dashboard banner with "Re-authorize Google" button (OAuth re-flow) |
| Worker crash mid-job | Job stuck in `running` | On worker start, any `running` job older than 5 min → reset to `queued` |

### 7.3 Idempotency

Every job kind is designed safe-to-retry:
- `send_message` — re-pre-fills the same chat with the same text; visible to operator who can skip.
- `check_replies` — cursor-based; re-running over the same window is a no-op for already-persisted messages.
- `classify_reply` — overwrites the same `replies` row's classification fields; re-run yields latest model output.
- `generate_follow_up` — checks for an existing un-sent `follow_ups` row for the invite before drafting.

Job rows are never deleted; they remain as audit log.

### 7.4 Observability

Single `/status` page in the dashboard surfacing:
- Worker heartbeat (timestamp of last successful job)
- WA Web session status (logged in / needs QR)
- Google API token expiry countdown
- Claude API status (last successful call, last error)
- Queue snapshot (queued / running / failed counts)
- Cron schedule with last/next run per cron

## 8. Setup / first-run

### 8.1 Prerequisites

- Anthropic API key. Expected spend: ~$0.20–0.50 per event with Sonnet 4.6 + prompt caching.
- Google Cloud project with OAuth 2.0 client and Sheets + Gmail APIs enabled. ~15 min one-time setup.
- A Google Sheet of contacts following the template (columns: `full_name, preferred_name, phone_e164, email, personal_note, interests`).
- WhatsApp number signed into WA Web at least once.

### 8.2 First-run wizard (dashboard)

1. Paste API keys → stored in `.env` (never leaves the laptop).
2. Authorize Google → OAuth popup; scopes `sheets.readonly` + `gmail.readonly`.
3. Pick contacts Sheet → URL paste; preview first 5 rows; confirm column mapping.
4. Import contacts → SQLite seeded.
5. Connect WhatsApp → "Open WA Web" → Playwright launches headed Chromium → operator scans QR once → session persists in `data/wa-profile/`.
6. Optional: install launchd plist for auto-start on login.
7. Set voice/style guide → free-text box; saved as cached system-prompt prefix.

### 8.3 Day-to-day loop

- New event: "Create event from Gmail" → pick EDM → pick contacts → generate drafts → review/approve → paste-confirm-send.
- 6pm daily: check dashboard for new replies + follow-ups → review/approve.

## 9. Testing approach

Pragmatic for a single-user local tool.

- **Unit tests** on pure logic: prompt builders, reply classifier outputs (canned reply text → expected classification), Sheet row parsers, cron schedule math.
- **Integration tests** on the SQLite job machinery: enqueue job → tick worker → assert state transitions.
- **No automated tests against real WA Web** — too fragile, would rot. Instead: a Playwright smoke test runnable on demand (`npm run wa-smoke`) — "log in check + find chat + read input box" with pass/fail report. Run after suspected WA changes.
- **No automated tests against real Google APIs** — mocks with recorded fixtures.

## 10. Locked defaults (from brainstorming)

| Decision | Choice |
|---|---|
| Transport | WhatsApp Web on Chrome (Playwright) — ToS risk accepted |
| Send model | Paste-don't-send; operator commits each send |
| Recurrence | 2–4 events/month, ~30–100 contacts each |
| Gmail role | One-time-per-event EDM source |
| Runtime | Local web UI (Next.js, `localhost:3000`) |
| Personalization | Name + event + per-contact hook + interests + prior attendance |
| Reply handling | Classify + draft response + day-3 follow-up for non-responders |
| Hosting | Local-only, single user |
| Stack | Next.js 16 / React 19 / Drizzle / SQLite / Playwright / Tailwind / shadcn / Sonnet 4.6 |
| Topology | Monorepo, two processes (web + worker), one SQLite file |
| Cron | node-cron, 6pm + noon catch-up + startup missed-run |
| Sheet | Seed-only; dashboard canonical |
| Launchd plist | Offered in setup, opt-in |
| Testing | Unit + integration; no live-WA or live-Google automated tests |

## 11. Deferred / open

- **Anthropic API key procurement** — operator to budget as setup step; spec assumes it will exist by implementation start.
- **Voice/style guide content** — free-text input to be filled during first-run; no spec opinion on its contents.
- **Sheet column mapping flexibility** — v1 assumes operator's Sheet matches the template; if real Sheets diverge, the import step will need an interactive column-mapper (defer to first real import).
- **Reply detection window** — set to 14 days post-send in §5.2 by default. Revisit if events span longer planning horizons.
- **Phone number formats in the Sheet** — assume E.164 (`+65...`). If operator's Sheet has local formats, an import-time normalizer is needed (defer to first real import).
- **Selector maintenance ownership** — accepted as operator's responsibility for now (or via Claude Code session when needed). No external maintenance contract.
