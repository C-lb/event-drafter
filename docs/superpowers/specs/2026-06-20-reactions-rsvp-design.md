# Reactions → RSVP — Design

**Date:** 2026-06-20
**Status:** Approved (design), pending implementation plan
**Scope:** Worker WA reader + `check_replies`; a new `classification_source`; a UI badge.

## Problem

When an invitee responds to a WhatsApp invite by **reacting** with an emoji
(👍, ❤️, etc.) instead of sending a text reply, the system sees nothing. A
reaction is not a message bubble — it is an emoji badge attached to *our
outbound* invite message, authored by the recipient. The reader
(`packages/worker/src/wa/reader.ts`) only scrapes inbound text rows, so a
reaction never becomes a reply and never sets the invite RSVP. The operator has
to notice it by hand.

## Goal

Treat a clear positive reaction as a "yes" RSVP and a clear negative reaction as
a "no", surfacing it in the replies queue like any other RSVP — without an LLM
call and without overriding a real text reply.

## Decisions (locked)

- **Mapping:** positive emoji (👍 ❤️ 🥰 😍 🎉 🙏 👏 ✅ 💯 🔥 and similar) → `yes`;
  clearly-negative (👎 😢 😞 ❌ 🚫 and similar) → `no`; everything else → ignored
  (no reply created).
- **Effect:** create/seed a `replies` row with `classification` = yes/no,
  `classification_source = 'reaction'`, `classification_confidence = 1.0`, a
  summary like `Reacted 👍`; set the invite `rsvp`. **No** response draft is
  enqueued.
- **Precedence:** a real text reply always wins. If an invite already has a
  reply whose source is `llm` or `manual`, the reaction is ignored entirely. A
  reaction only seeds a row when there is no reply, or only a prior
  reaction-sourced row. A later text reply overrides a reaction row through the
  existing `check_replies` update path.

## Out of scope (YAGNI)

- Auto-drafting a response from a reaction.
- Neutral / hesitant emoji → maybe / unclear.
- Reaction **removal** (un-reacting does not un-RSVP).
- Reactions in group chats (invites are 1:1).

## Key risk: DOM feasibility

WhatsApp Web's June-2026 markup refresh already broke the send-confirmation
selectors (see `2026-06-20` send fix). How the current build renders reactions —
and whether we can reliably read (a) the emoji and (b) that it was authored by
the recipient (not us) on our outbound bubble — is **unknown**. Implementation
therefore **starts with a DOM spike** (a read-only live probe, same technique
used to find `tail-out` / the `aria-label` delivery status). If reactions are
not reliably scrapeable, the design changes and we return to the user before
building further. The spike needs a real reaction present in a chat as a
fixture (an invitee reacting to a sent invite, or the operator adding one).

## Architecture

Small, isolated units; the pure logic is unit-tested, the DOM glue is validated
by the spike.

### 1. `reactionToClassification(emoji)` — pure (new)
`(emoji: string) => 'yes' | 'no' | null`. Holds the positive/negative emoji
sets; returns `null` for anything unmapped. The single source of truth for the
mapping; fully unit-tested. Lives in the worker (e.g.
`packages/worker/src/wa/reactions.ts`).

### 2. `reader.ts` — extended scraping
Add reaction reading alongside the existing inbound-text scrape. New interface
`InboundReaction { emoji: string; ts: Date | null }` for reactions the
**recipient** added to **our** outbound bubbles, kept separate from
`InboundMessage`. `readChatInbound` (or a sibling `readChatReactions`) returns
them. The exact selectors are determined by the spike; the function signature
is the stable interface the rest of the design depends on.

### 3. `reactionRsvpDecision(...)` — pure (new)
Given the new reaction's mapped classification and the existing reply's source
(or none), decide: `upsert` (with classification yes/no) or `skip`. Encodes the
precedence rule. Unit-tested independently of the DB.

### 4. `check_replies` — new branch
After the existing text-reply handling for an invite, read recipient reactions
in the invite window. For the most recent reaction mapping to yes/no, apply
`reactionRsvpDecision` against any existing reply:
- `skip` → do nothing (text reply or same reaction already present).
- `upsert` → insert or update the `replies` row with `classification`,
  `classification_source = 'reaction'`, confidence `1.0`, summary `Reacted
  <emoji>`; set the invite `rsvp`. **Do not** enqueue `classify_reply` or any
  draft job.

### 5. `classification_source = 'reaction'`
Add `reaction` to the `CLASSIFICATION_SOURCES` union (alongside `llm`,
`manual`). No migration needed — the column already exists (TEXT). `ReplyCard`
renders a small badge for it, mirroring the existing `✎ manual` badge, e.g.
`👍 reaction`.

## Data flow

```
check_replies (per sent invite)
  -> reader: inbound text rows      (unchanged path)
  -> reader: recipient reactions    (new)
       -> reactionToClassification(emoji) => yes | no | null
          - null            -> ignore
          - yes/no:
              existing reply source llm|manual -> skip (text wins)
              else -> upsert replies row (classification, source='reaction',
                      conf 1.0, summary "Reacted <emoji>") + set invite rsvp
                      (no classify/draft job)
```

## Error handling

- Reaction scraping is best-effort: a scrape failure logs and is skipped, never
  aborts the text-reply path (mirrors the reader's existing
  misclassify-conservatively stance).
- An unmapped/unknown emoji is ignored, not an error.

## Testing

- **Unit:** `reactionToClassification` (positive set → yes, negative set → no,
  neutral/unknown → null, empty → null); `reactionRsvpDecision` (no reply →
  upsert; llm/manual reply → skip; prior reaction reply → upsert/refresh).
  These hold all the real logic.
- **Spike + manual:** characterize the reaction DOM live, then confirm
  end-to-end against a real reacted invite (worker reads it, a `reaction`
  reply appears in `/replies` with the badge and correct RSVP).

## Risk

Medium — gated on the DOM spike. The pure logic and DB branch are low-risk and
mirror existing patterns (the manual-override flow already established
`classification_source`). The unknown is purely WA reaction DOM, isolated to
`reader.ts` behind the `InboundReaction` interface.
