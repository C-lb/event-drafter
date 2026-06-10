# Project context

Operating context for this codebase. Future Claude sessions should read this before changing worker code, rate limits, or any UI flow that drives WhatsApp Web. The constraints here are real-world constraints from the operator, not engineering preferences.

---

## What this is

A local-first WhatsApp Web automation for personal VIP event invitations. Operator (Caleb) sends 60–400 personalized messages per month across 2–4 events. Drafts and replies pass through an LLM (Ollama locally, or the Anthropic API). A human approves every send.

---

## Hard constraint: WhatsApp must believe a human is at the keyboard

WhatsApp aggressively rate-limits and bans accounts they suspect are running automation. The operator's number is the operator's actual number — a ban is a real-world cost. **Every interaction with WhatsApp Web must look like a slow, deliberate human.**

### UI interaction timing

- **Minimum 300–500 ms between any two UI interactions** in the WA Web Playwright session. Clicks, fills, key presses, navigations — all subject to this.
- **Never fire two interactions in parallel.** One click at a time. No batched DOM operations from the same `Promise.all`.
- `humanPause()` in `packages/worker/src/wa/driver.ts` is the canonical helper — call it before each interaction.

### Sending cadence

- **Batches of 5–8 messages**, randomly sized.
- **Minimum 2:59 (179 seconds) between successive sends**, with random scatter up to ~5 minutes.
- **After each batch, cool down 15–30 minutes** before starting the next batch. The cool-down is also randomized.
- Soft cap: ~18 sends per hour. The rate limiter at `packages/worker/src/rate-limit.ts` enforces these.

### Why these numbers

These are calibrated to look like a human personally typing each message:
- A real person can't physically type a 4-sentence WhatsApp message and switch chats in under ~3 minutes once you factor in reading, editing, and pasting.
- Bursts of 5–8 then a longer break mimics a coffee break / phone-down rhythm.
- The 300–500 ms click delay defeats WhatsApp's behavioural fingerprinting that flags inhuman click sequences.

### What NOT to do

- Don't add a "send now" button that bypasses the rate limiter.
- Don't introduce a "send to N contacts in parallel" feature.
- Don't lower `MIN_GAP_MS`, `COOLDOWN_MIN_MS`, or `HUMAN_PAUSE_*` constants without operator sign-off.
- Don't pre-fill multiple chats in a single Playwright tick — sequential only.
- Don't auto-click the WA send button. The human always clicks send themselves.

---

## Operator profile

- Singapore-based. Events skew business-social, often hybrid English/Mandarin/Cantonese.
- VIP contacts are senior people; tone must read as warm-but-brief, not transactional.
- Operator manually reviews **every** drafted invite and **every** reply response before send.
- "Mark sent" is a manual click — the worker doesn't infer send completion automatically.

---

## LLM provider

- Default: **Ollama** with `qwen2.5:7b-instruct` running on the operator's Mac (`localhost:11434`).
- Alternate: **Anthropic API** (`claude-sonnet-4-6`) when `LLM_PROVIDER=anthropic` in `.env`.
- Provider selection lives in `packages/worker/src/llm/client.ts`. Both share the same `complete()` signature.
- The classifier (`classify_reply`) relies on strict JSON. Ollama uses `format: "json"`; Anthropic relies on prompt discipline.

---

## Reply checking

- Cron: noon + 6 PM SGT (`packages/worker/src/scheduler.ts`).
- Per contact: scrape the WA chat pane, **cap at last 10 inbound messages**, only consider those with `wa_sent_at >= invite.sent_at`.
- A "Check now" button on `/replies` enqueues an on-demand `check_replies` job (idempotent).
- See `packages/worker/src/jobs/check-replies.ts` and `packages/worker/src/wa/reader.ts`.

---

## Drafting source of truth

- Reference message patterns live at `templates/draft-messages.md`.
- Operator pastes relevant sections into `/settings/style-guide`, which gets injected into every prompt system message.
- See `packages/worker/src/llm/prompts.ts` for prompt structure.

---

## Job lifecycle invariants

- Every send-side job has a manual approval gate in the dashboard (`draft_invite` → `drafted` → operator approves → `approved` → worker pre-fills → `prefilled` → operator clicks send in WA → operator clicks Mark Sent → `sent`).
- The worker **pre-fills**, never **sends**. The send button click in WA is always human.
- `cleanup_jobs` deletes succeeded jobs older than 30 days; failures are kept for forensics.

---

## When in doubt

Default toward slower, more cautious, more human. The cost of a WhatsApp ban is far higher than the cost of one event's invites going out an hour later.
