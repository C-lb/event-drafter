# Project context

Operating context for this codebase. Future Claude sessions should read this before changing worker code, rate limits, or any UI flow that drives WhatsApp Web. The constraints here are real-world constraints from the operator, not engineering preferences.

---

## What this is

A local-first WhatsApp Web automation for personal VIP event invitations. Operator (Caleb) sends 60–400 personalized messages per month across 2–4 events. Drafts and replies pass through an LLM (Ollama locally, or the Anthropic API). A human approves every send.

---

## Hard constraint: WhatsApp must believe a human is at the keyboard

WhatsApp aggressively rate-limits and bans accounts they suspect are running automation. The operator's number is the operator's actual number, and a ban is a real-world cost. **Every interaction with WhatsApp Web must look like a slow, deliberate human.**

The cadence rules below (300-500 ms pauses, 2:59+ between sends, 5-8 message batches, 15-30 min cool-down) are non-negotiable regardless of which send mode is active.

### UI interaction timing

- **Minimum 300–500 ms between any two UI interactions** in the WA Web Playwright session. Clicks, fills, key presses, navigations — all subject to this.
- **Never fire two interactions in parallel.** One click at a time. No batched DOM operations from the same `Promise.all`.
- `humanPause()` in `packages/worker/src/wa/driver.ts` is the canonical helper — call it before each interaction.

### Sending cadence

- **Batches of 5–8 messages**, randomly sized.
- **Minimum 30 seconds between successive sends**, with random scatter up to 60 seconds. *(Lowered 2026-06-11 from the original 2:59 floor on explicit operator sign-off; raises WA ban risk.)*
- **After each batch, cool down 15–30 minutes** before starting the next batch. The cool-down is also randomized.
- Soft cap: ~18 sends per hour. The rate limiter at `packages/worker/src/rate-limit.ts` enforces these.

### Why these numbers

These are calibrated to look like a human personally typing each message:
- A real person can't physically type a 4-sentence WhatsApp message and switch chats in under ~3 minutes once you factor in reading, editing, and pasting. *(The current 30 s floor only buys ~30 s of typing time. Watch for WA challenges and bump back up if so.)*
- Bursts of 5–8 then a longer break mimics a coffee break / phone-down rhythm.
- The 300–500 ms click delay defeats WhatsApp's behavioural fingerprinting that flags inhuman click sequences.

### What NOT to do

- Don't add a "send now" button that bypasses the rate limiter.
- Don't introduce a "send to N contacts in parallel" feature.
- Don't lower `MIN_GAP_MS`, `COOLDOWN_MIN_MS`, or `HUMAN_PAUSE_*` constants without operator sign-off.
- Don't pre-fill multiple chats in a single Playwright tick. Sequential only.

---

## Send mode (auto-send vs human-click)

The setting `auto_send_enabled` decides who clicks WA Web's send button after the worker pre-fills a chat.

- **`false` (default before 2026-06-11):** worker pre-fills, the operator clicks send and then Mark Sent. Maximum human fingerprint, slowest throughput.
- **`true` (operator opted in 2026-06-11):** worker clicks send via `clickSendInPrefilledChat()` in `packages/worker/src/wa/driver.ts` and marks the invite sent automatically.

Even with auto-send on, the rate limiter (`packages/worker/src/rate-limit.ts`) still enforces 2:59+ between sends and the 5-8 message batch / cool-down cadence. Auto-send only removes the manual click, not the timing envelope.

If WA Web starts challenging the account (extra QR re-scans, "Use here" prompts, sudden silence on outbound), flip `auto_send_enabled` back to `false` and revert to manual click.

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
- Per contact: walk the WA chat pane **backwards from the most recent message** and collect inbound messages until we hit the first outbound row (our last invite or follow-up). Everything before that anchor is ignored. See `collectThreadSinceLastOutbound()` in `packages/worker/src/wa/reader.ts`.
- The collected thread is then filtered against a **per-invite date anchor**: any message older than the start of the day on which *that specific invite* was sent (`invites.sent_at` truncated to local midnight) is dropped. The reply UI only ever shows chat from the day the contact was invited onward; pre-invite chitchat is invisible to the operator and to the LLM.
- The thread is joined chronologically into a single `wa_message_text` (separator `\n— next message —\n`) and stored on exactly **one `replies` row per invite**. Repeated `check_replies` runs update that same row instead of inserting new ones, so each VIP contact has at most one reply on the dashboard regardless of how many WA messages they sent.
- When the joined text changes between runs, classification + `response_draft` are cleared and `response_status` resets to `pending` so the operator gets a fresh draft for the new message. This also applies to threads where we'd previously responded: `response_sent_at` is preserved as audit history but the row drops back into the pending queue until the recipient sends another message, at which point the cycle repeats.
- After we reply (auto-send or manual Mark Sent), `response_status` is held at **`pending`** with `response_sent_at` set. The conversation is conceptually still open until the recipient sends another message. UI distinguishes three pending sub-states via `response_sent_at` and `wa_sent_at`: brand-new pending (`needs review`), replied-but-no-new-inbound (`awaiting their reply`), and replied-but-they-sent-again (`they replied again`). `sent` is now reserved for terminal "we explicitly closed this thread" outcomes if any code ever needs it; the default lifecycle never reaches it.
- A "Check now" button on `/replies` enqueues an on-demand `check_replies` job (idempotent).
- See `packages/worker/src/jobs/check-replies.ts` and `packages/worker/src/wa/reader.ts`.

---

## Drafting source of truth

- Reference message patterns live at `templates/draft-messages.md`.
- Operator pastes relevant sections into `/settings/style-guide`, which gets injected into every prompt system message.
- See `packages/worker/src/llm/prompts.ts` for prompt structure.

### Reply voice

- **Most replies should contain no em dashes (`—`).** They read as LLM-generated. Use commas, periods, or a new sentence instead. Rare exceptions are fine but the default is zero.
- **Fully humanised.** Contractions, casual phrasing, no stock chatbot openers ("Absolutely!", "Of course!", "Happy to help!"), no trailing summaries of what was just said. Read it aloud — if it sounds like a press release or a support macro, rewrite.
- Same rule applies to invite drafts (already in the Sara sign-off block) — restating here because reply drafts have been drifting.

---

## Job lifecycle invariants

- Every send-side job has a manual approval gate in the dashboard (`draft_invite` → `drafted` → operator approves → `approved` → worker pre-fills → `prefilled` → operator clicks send in WA → operator clicks Mark Sent → `sent`).
- The worker **pre-fills**, never **sends**. The send button click in WA is always human.
- `cleanup_jobs` deletes succeeded jobs older than 30 days; failures are kept for forensics.

---

## When in doubt

Default toward slower, more cautious, more human. The cost of a WhatsApp ban is far higher than the cost of one event's invites going out an hour later.
