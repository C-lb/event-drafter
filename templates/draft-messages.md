# Draft message templates

Reference patterns for invite drafts, replies to responses, and follow-ups. Paste the section that fits the scenario into the **style guide** at `/settings/style-guide` — that string is injected into every prompt's system message and shapes the LLM's voice.

Variables in `{braces}` are stand-ins; the LLM will fill them from the event/contact context. Keep templates short — the model copies tone and structure more than literal phrases.

---

## Style baseline (always-on)

- Warm but brief. 2–4 sentences for an invite, 1–3 for a reply, 1–3 for a follow-up.
- One personal hook per message, used naturally — never list interests like a CV.
- Reference at most one prior event lightly. No "I see you came to all 4 of our events" recaps.
- No emoji unless the contact uses them first.
- Sign off with the operator's first name only. No company signature block (this is WhatsApp, not email).
- Don't repeat logistics that are in the formal EDM email — assume they got both.
- English by default. Switch to Mandarin/Cantonese only if the contact's prior replies were in that language.

---

## A. First invitation (new VIP, no prior history)

**Pattern: hook → event line → light close.**

> Hey {Preferred}, hope you're well — saw you've been doing great things in {personal hook}. We're putting together {event name} on {date} at {venue}, and I'd love to have you in the room. Let me know if it might work for you.
>
> — {Operator}

> Hi {Preferred}, {operator} here. {Personal hook reference}. We're hosting {event name} on {date} — small, curated group, the kind of evening I think you'd enjoy. Worth checking your calendar?

---

## B. Repeat invitation — they attended last time

> {Preferred}, hope all's well. Putting another one of these together — {event name} on {date} at {venue}. After how the {prior event} went, would love to have you back. Let me know.

> Hi {Preferred}, it's been a while. {Event name} is happening on {date}; the format is similar to {prior event} — small, considered group. Let me know if you'd like to come.

---

## C. Repeat invitation — they didn't attend last time

Keep it light, no guilt.

> Hey {Preferred}, hope life's been kind. We're doing {event name} on {date} — different theme from last time, lighter format. No pressure, just thought I'd float it back up.

> Hi {Preferred}, quick one — {event name} on {date}. Know last time didn't work out, but the lineup for this one feels relevant to {personal hook}. Let me know if you're around.

---

## D. Follow-up — no reply after 3 days

Acknowledge gently, leave the door open.

> Hey {Preferred}, just floating this back up in case it got buried — {event name} on {date}. No pressure at all; if it's a no, all good. Just wanted to make sure you saw it.

> Hi {Preferred}, no rush on this — but circling back on {event name}. If now's not the right time to think about it, completely fine. Just on my radar to ask once more.

---

## E. Replies to inbound responses

### E1. They said yes
> Lovely, looking forward to having you there. I'll send the calendar invite and final logistics closer to the date.

> Great, thanks {Preferred} — got you down. More details to follow.

### E2. They said no (with reason)
> Totally understand, thanks for letting me know. Hope to see you at the next one.

> No worries, appreciate the quick reply. Will keep you on the list for the next round.

### E3. They said maybe / asking for info
Don't promise specifics that aren't in the EDM. Defer or confirm only what's already true.

> Of course — to recap, it's {date} at {venue}, runs about {duration}, dress code is {dress code}. Let me know once you've checked.

> Take your time — I'll send a reminder closer to the date and you can decide then.

### E4. They asked a logistics question (parking, food, who else)
Answer briefly if you know; defer if you don't.

> Yes, valet at the venue. Anything else you'd like to know?

> Good question — let me confirm and come back to you on that.

### E5. Off-topic acknowledgement ("ok", "thanks", "haha")
The classifier will mark these as `unclear`. The default response should be brief and not push.

> 👍 anytime.
>
> (or just leave it — `skipped` is a valid action here.)

---

## F. Operator notes for the LLM

These notes go into the style guide string verbatim. They're prescriptive overrides the model should follow even when other inputs would suggest otherwise.

```
Always:
- Open with a personal hook from `personal_note` or `interests`, woven into one natural sentence.
- Use the contact's `preferred_name`, never the full name unless preferred_name is missing.
- Sign off with the operator's first name on its own line.

Never:
- Use "Dear {Name}" — too formal for WhatsApp.
- Reference the email/EDM in the WhatsApp message ("as per my email").
- Promise times, dress codes, or attendee lists that aren't in the event facts provided.
- Use bullet points or markdown — WhatsApp doesn't render them, plain prose only.
- Send more than one message in a single draft — one cohesive paragraph max.
```

---

## How to use this file

Two modes:

**Manual (today):** Pick the section that matches the scenario, paste relevant lines into `/settings/style-guide` in the dashboard. That string is added to the system prompt of every `draft_invite`, `classify_reply`, and `generate_follow_up` call.

**Auto-wired (future):** Have the worker load `templates/draft-messages.md` at job start and inject the relevant section into the prompt based on the situation (first invite vs repeat vs follow-up). Ask if you want this wired — it's ~50 lines.
