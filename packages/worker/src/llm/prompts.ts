import type { PromptBlock } from './client.js';
import type { Contact, Event } from '@event-drafter/core';
import { sanitizeDraft } from './sanitize.js';

export interface AttendanceFact {
  event_name: string;
  event_date: Date;
  attended: boolean;
  notes: string | null;
}

export interface DraftPromptInput {
  event: Pick<Event, 'name' | 'event_date' | 'venue' | 'edm_subject' | 'edm_body' | 'edm_summary'>;
  contact: Pick<Contact, 'first_name' | 'last_name' | 'remarks'>;
  attendance_history: AttendanceFact[];
  style_guide: string;
  /** Persona signed at the bottom of every WA message. Defaults to "Sara". */
  operator_first_name?: string;
  /** Role line after the name in the sign-off. Defaults to "Community Manager @ SPARK". */
  operator_role?: string;
}

const PROMPT_VERSION = 'v2';

/**
 * Voice rules shared by every prompt that drafts text for a human recipient.
 * Each draft also passes through `sanitizeDraft()` after generation, so any
 * em/en-dash that slips through is mechanically stripped — but the goal here
 * is to never need that fallback in the first place.
 */
const HUMAN_VOICE_RULES = `Write like a real person typing on WhatsApp, not a press release or an AI assistant. The recipient should not be able to guess this was machine-drafted.

Punctuation:
- ABSOLUTELY NO em dashes (—) or en dashes (–). Not in any form. Use a comma, a period, or split into two sentences. This rule is enforced post-hoc; if you emit a dash it will be stripped, leaving awkward output.
- No semicolons. Break the sentence.
- No double-spaces after periods.

Vocabulary to AVOID (these are dead giveaways of AI writing):
- "I trust this finds you well", "I hope this message finds you well"
- "Reaching out to", "Just wanted to reach out", "Just a quick note"
- "We would be delighted", "We are pleased to", "It is our pleasure"
- "Kindly", "Please find attached", "Should you have any queries"
- "Looking forward to hearing from you" (as a sign-off — too formal)
- "Esteemed", "valued", "cherished"
- "Moreover", "Furthermore", "Additionally", "In conclusion"
- Long flowery openers about the event's significance.

Vocabulary to PREFER:
- Warm, direct, present-tense phrasing.
- Contractions: "it's", "we're", "don't", "you'll".
- Short clauses.
- One concrete detail that shows this isn't a form letter — name them, mention the venue or what they said before, reference a remark naturally.

Tone calibration: imagine a friend who happens to run events texting a senior contact. Warm, not gushing. Confident, not stiff. Personal, not mass-blast.`;

const GENERIC_RULES = `You are drafting a personal WhatsApp invitation message that will be reviewed and manually sent by the operator. Output ONLY the message body. No greeting metadata, no "Here is the message:", no quotes around the message, no Markdown formatting.

Body length:
- 2-4 sentences in the message body. Hard cap.
- Use the supplied Remarks naturally in one sentence. Do not list them like a CV.
- If attendance history is supplied, you may reference at most ONE prior event lightly.
- Do not repeat the formal EDM verbatim. Assume the recipient will also receive that email separately.
- Output plain text. No emoji unless the style guide explicitly allows them.

Structure (mandatory — match the SPARK draft templates):
1. Salutation line on its own: "Good morning [preferred_name]," before 12:00 SGT, "Good afternoon [preferred_name]," from 12:00 onwards.
2. ONE blank line.
3. The body (the 2-4 sentences above), split across 1-2 short paragraphs separated by a blank line. Use real "\\n\\n" line breaks between paragraphs.
4. ONE blank line.
5. Sign-off block on three separate lines, exactly:
   Regards,
   <Operator name>
   <Operator role>
   No extra blank line inside the sign-off.

${HUMAN_VOICE_RULES}`;

export function buildDraftPrompt(input: DraftPromptInput): PromptBlock {
  const eventDateStr = new Date(input.event.event_date).toLocaleDateString('en-SG', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const systemHeader = `# Style guide

${input.style_guide}

# General drafting rules

${GENERIC_RULES}

# Event context

Event: ${input.event.name}
When: ${eventDateStr}
Venue: ${input.event.venue ?? '(not specified — do not invent one)'}

## Event facts (extracted from EDM — use these as the authoritative reference)

${input.event.edm_summary ?? '(no structured summary supplied — rely on the EDM body below)'}

## Formal invitation (EDM) for reference

Subject: ${input.event.edm_subject ?? '(none)'}

${input.event.edm_body ?? '(no EDM body supplied — keep the message generic about the event)'}

# Operator persona
Sign off with the three-line sign-off block, using exactly:
Regards,
${input.operator_first_name ?? 'Sara'}
${input.operator_role ?? 'Community Manager @ SPARK'}

# Prompt version: ${PROMPT_VERSION}`;

  const attendanceLines = input.attendance_history.length
    ? input.attendance_history
        .map((f) => `- ${f.event_name} (${new Date(f.event_date).toISOString().slice(0, 10)}): ${f.attended ? 'attended' : 'did not attend'}${f.notes ? ` — ${f.notes}` : ''}`)
        .join('\n')
    : '(no prior events on record)';

  const fullName = `${input.contact.first_name}${input.contact.last_name ? ' ' + input.contact.last_name : ''}`;
  const userMessage = `# Contact

Full name: ${fullName}
Preferred name: ${input.contact.first_name}
Remarks: ${input.contact.remarks ?? '(none — keep the message warm but generic)'}

# Attendance history

${attendanceLines}

# Task

Draft the WhatsApp invitation to this contact for the event above. Output only the message body.`;

  return {
    system: [
      { type: 'text', text: systemHeader, cache_control: { type: 'ephemeral' } },
    ],
    user: userMessage,
  };
}

export const __prompt_version = PROMPT_VERSION;

// ===== Classify + Draft Response (Plan 5) =====

export interface ClassifyAndDraftInput {
  event: Pick<Event, 'name' | 'event_date' | 'venue'>;
  contact: Pick<Contact, 'first_name' | 'last_name' | 'remarks'>;
  original_invite_text: string;
  reply_text: string;
  style_guide: string;
  operator_first_name?: string;
  /**
   * Past operator corrections: messages the operator manually classified, fed
   * back as few-shot examples so the model tags similar messages the same way
   * next time. Empty/absent on a cold start.
   */
  examples?: Array<{ text: string; classification: string }>;
}

export interface ClassifyAndDraftOutput {
  classification: 'yes' | 'no' | 'maybe' | 'unclear';
  confidence: number;
  summary: string;
  response_draft: string;
}

const CLASSIFY_RULES = `You are reading a reply to a WhatsApp event invitation. Output a single JSON object with the following shape and NOTHING ELSE:

{
  "classification": "yes" | "no" | "maybe" | "unclear",
  "confidence": <number between 0 and 1>,
  "summary": "<at most 80 chars, one line>",
  "response_draft": "<1-3 sentence reply matching the operator's style guide>"
}

Classification rules:
- "yes": clearly accepting (e.g. "see you there", "count me in", "will be there")
- "no": clearly declining (e.g. "can't make it", "out of town", "won't be able to")
- "maybe": tentative, conditional, or asking for info (e.g. "let me check", "what time again?")
- "unclear": cannot determine, off-topic, or just acknowledgement (e.g. "ok", "thanks", "haha")

The response_draft must be brief, match the supplied style guide, and not promise anything specific (no times, no logistics) unless the reply asked for it.

Sign-off: do NOT append the operator's name, role, "Regards,", or any closing block. The recipient already received the original invitation in this same WhatsApp thread, so they know who is replying. The response_draft is just the body, a sentence or two that reads like a quick personal message, not a formal letter.

${HUMAN_VOICE_RULES}`;

export function buildClassifyAndDraftPrompt(input: ClassifyAndDraftInput): PromptBlock {
  const eventDateStr = new Date(input.event.event_date).toLocaleDateString('en-SG', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const systemHeader = `# Style guide

${input.style_guide}

# Classification + response rules

${CLASSIFY_RULES}

# Event context

Event: ${input.event.name}
When: ${eventDateStr}
Venue: ${input.event.venue ?? '(not specified)'}`;

  const fullName = `${input.contact.first_name}${input.contact.last_name ? ' ' + input.contact.last_name : ''}`;

  // Learned examples from the operator's past manual corrections. Kept in the
  // (uncached) user message so the cached system rules stay stable as the
  // example set grows.
  const examplesBlock =
    input.examples && input.examples.length > 0
      ? `# How the operator has classified similar replies before
Match these judgements when a reply is similar:
${input.examples
  .map((e) => `- "${e.text.replace(/\s+/g, ' ').trim().slice(0, 200)}" -> ${e.classification.toUpperCase()}`)
  .join('\n')}

`
      : '';

  const userMessage = `# Contact
Name: ${fullName} (preferred: ${input.contact.first_name})
Remarks: ${input.contact.remarks ?? '(none)'}

# Original invitation we sent
${input.original_invite_text}

${examplesBlock}# Their reply
${input.reply_text}

Output the JSON object now. Do not wrap it in code fences. Do not add commentary.`;

  return {
    system: [{ type: 'text', text: systemHeader, cache_control: { type: 'ephemeral' } }],
    user: userMessage,
  };
}

export function parseClassifyAndDraft(raw: string): ClassifyAndDraftOutput {
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  const obj = JSON.parse(stripped);
  if (typeof obj !== 'object' || obj === null) throw new Error('classify: not an object');
  const c = obj.classification;
  if (!['yes', 'no', 'maybe', 'unclear'].includes(c)) throw new Error(`classify: bad classification "${c}"`);
  const confidence = Number(obj.confidence);
  if (Number.isNaN(confidence) || confidence < 0 || confidence > 1) throw new Error('classify: bad confidence');
  const summary = String(obj.summary ?? '').slice(0, 80);
  const response_draft = String(obj.response_draft ?? '').trim();
  if (!response_draft) throw new Error('classify: empty response_draft');
  // Sanitize at the parse boundary so every downstream consumer (the job
  // handler, the editResponse server action that re-uses parsed text) gets
  // the same em-dash-free output. See packages/worker/src/llm/sanitize.ts.
  return {
    classification: c,
    confidence,
    summary,
    response_draft: sanitizeDraft(response_draft),
  };
}

// ===== Redraft for an operator-forced classification =====

export interface RedraftForClassificationInput {
  event: Pick<Event, 'name' | 'event_date' | 'venue'>;
  contact: Pick<Contact, 'first_name' | 'last_name' | 'remarks'>;
  original_invite_text: string;
  reply_text: string;
  /** The classification the operator forced — the draft must honour this. */
  classification: 'yes' | 'no' | 'maybe' | 'unclear';
  style_guide: string;
}

const CLASSIFICATION_INTENT: Record<RedraftForClassificationInput['classification'], string> = {
  yes: 'The operator has decided this contact IS attending. Draft a warm reply that treats them as coming, thanks them, and says we look forward to seeing them. Do not ask whether they can make it.',
  no: 'The operator has decided this contact is NOT attending. Draft a gracious reply that accepts the decline with no guilt-tripping, says they will be missed, and leaves the door open for a future event.',
  maybe: 'The operator has decided this contact is a MAYBE. Draft a no-pressure reply that acknowledges they are still deciding, offers to hold a spot or answer any questions, and makes it easy to confirm later.',
  unclear: 'The operator has marked this reply UNCLEAR. Draft a friendly reply that gently asks them to confirm whether they can make it, without assuming a yes or a no.',
};

const REDRAFT_RULES = `You are drafting the operator's WhatsApp reply to a contact who responded to an event invitation. The operator has already JUDGED how to treat this contact (see the decision below); your job is only to write a reply that matches that decision, even if the contact's own words were ambiguous.

Hard rules:
- Output ONLY the message body. No JSON, no quotes, no Markdown, no "Here is the message".
- 1-3 sentences.
- Honour the operator's decision exactly. Do not hedge against it or re-litigate what the contact "really" meant.
- Do not promise specific times or logistics unless the contact explicitly asked.
- Do NOT append the operator's name, role, "Regards,", or any closing block. The original invite in this WhatsApp thread already carried the sign-off, so this reads as a continuation, not a new formal letter.

${HUMAN_VOICE_RULES}`;

export function buildRedraftForClassificationPrompt(input: RedraftForClassificationInput): PromptBlock {
  const eventDateStr = new Date(input.event.event_date).toLocaleDateString('en-SG', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const systemHeader = `# Style guide

${input.style_guide}

# Reply drafting rules

${REDRAFT_RULES}

# Event context

Event: ${input.event.name}
When: ${eventDateStr}
Venue: ${input.event.venue ?? '(not specified)'}`;

  const fullName = `${input.contact.first_name}${input.contact.last_name ? ' ' + input.contact.last_name : ''}`;
  const userMessage = `# Contact
Name: ${fullName} (preferred: ${input.contact.first_name})
Remarks: ${input.contact.remarks ?? '(none)'}

# Original invitation we sent
${input.original_invite_text}

# Their reply
${input.reply_text}

# Operator's decision: ${input.classification.toUpperCase()}
${CLASSIFICATION_INTENT[input.classification]}

Draft the reply body now.`;

  return {
    system: [{ type: 'text', text: systemHeader, cache_control: { type: 'ephemeral' } }],
    user: userMessage,
  };
}

export function parseRedraft(raw: string): string {
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  const draft = sanitizeDraft(stripped);
  if (!draft) throw new Error('redraft: empty response_draft');
  return draft;
}

// ===== Follow-up (Plan 6) =====

export interface FollowUpInput {
  event: Pick<Event, 'name' | 'event_date' | 'venue'>;
  contact: Pick<Contact, 'first_name' | 'last_name' | 'remarks'>;
  original_invite_text: string;
  days_since_sent: number;
  style_guide: string;
  operator_first_name?: string;
}

const FOLLOW_UP_RULES = `Draft a short, no-pressure WhatsApp follow-up to a contact who hasn't replied to the original invitation. Output ONLY the message body (no greetings metadata, no quotes, no Markdown).

Hard rules:
- 1-3 sentences.
- Acknowledge gently that they might have missed the first message; do NOT guilt-trip.
- Reference the event briefly but do not re-paste the original invite.
- Leave the door open ("no pressure at all, just floating it back up").
- Match the style guide's tone exactly.
- Do NOT append the operator's name, role, "Regards,", or any closing block. The original invite in this WhatsApp thread already carried the sign-off, so the follow-up reads as a continuation, not a new formal letter.

${HUMAN_VOICE_RULES}`;

export function buildFollowUpPrompt(input: FollowUpInput): PromptBlock {
  const eventDateStr = new Date(input.event.event_date).toLocaleDateString('en-SG', {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  const systemHeader = `# Style guide

${input.style_guide}

# Follow-up drafting rules

${FOLLOW_UP_RULES}

# Event context
Event: ${input.event.name}
When: ${eventDateStr}
Venue: ${input.event.venue ?? '(not specified)'}`;

  const fullName = `${input.contact.first_name}${input.contact.last_name ? ' ' + input.contact.last_name : ''}`;
  const userMessage = `# Contact
Name: ${fullName} (preferred: ${input.contact.first_name})
Remarks: ${input.contact.remarks ?? '(none)'}

# Original invite (sent ${input.days_since_sent} day${input.days_since_sent === 1 ? '' : 's'} ago, no reply)
${input.original_invite_text}

Draft the follow-up now.`;

  return {
    system: [{ type: 'text', text: systemHeader, cache_control: { type: 'ephemeral' } }],
    user: userMessage,
  };
}

// ===== Targeted follow-up (Plan 7) =====

const TARGETED_FOLLOW_UP_RULES = `You are writing a short WhatsApp follow-up to someone we already invited to an event. This is a nudge or a logistics update, not a fresh invite.

- 1 to 3 sentences. No sign-off block, no signature (it reads as a continuation of the same chat).
- Do not re-paste the original invite. Reference the event briefly by name.
- Warm, no pressure, no guilt-tripping about a missing reply.
- If a "Logistics to weave in" section is present, mention ONLY those points, briefly and naturally, as helpful updates. If it is absent, write a plain friendly reminder.

${HUMAN_VOICE_RULES}`;

export interface TargetedFollowUpLogistics {
  food_pref?: string | null;
  chauffeured: boolean;
  parking_coupon: boolean;
  takes_bus: boolean;
}

export interface TargetedFollowUpInput {
  event: Pick<Event, 'name' | 'event_date' | 'venue'>;
  contact: Pick<Contact, 'first_name' | 'last_name' | 'remarks'>;
  mode: 'general' | 'tailored';
  logistics?: TargetedFollowUpLogistics;
  style_guide: string;
  operator_first_name?: string;
}

export function buildTargetedFollowUpPrompt(input: TargetedFollowUpInput): PromptBlock {
  const eventDateStr = new Date(input.event.event_date).toLocaleDateString('en-SG', {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  const systemHeader = `# Style guide

${input.style_guide}

# Follow-up drafting rules

${TARGETED_FOLLOW_UP_RULES}

# Event context
Event: ${input.event.name}
When: ${eventDateStr}
Venue: ${input.event.venue ?? '(not specified)'}`;

  const logisticsLines: string[] = [];
  if (input.mode === 'tailored' && input.logistics) {
    const l = input.logistics;
    if (l.food_pref && l.food_pref.trim()) logisticsLines.push(`Dietary / food note: ${l.food_pref.trim()}`);
    if (l.parking_coupon) logisticsLines.push('We are giving them a parking coupon.');
    if (l.takes_bus) logisticsLines.push('They are riding our shuttle bus to the venue.');
    if (l.chauffeured) logisticsLines.push('We are arranging a car to chauffeur them.');
  }
  const logisticsBlock = logisticsLines.length
    ? `\n\n# Logistics to weave in (mention only these)\n${logisticsLines.map((s) => `- ${s}`).join('\n')}`
    : '';

  const fullName = `${input.contact.first_name}${input.contact.last_name ? ' ' + input.contact.last_name : ''}`;
  const userMessage = `# Contact
Name: ${fullName} (preferred: ${input.contact.first_name})
Remarks: ${input.contact.remarks ?? '(none)'}${logisticsBlock}

Draft the follow-up now.`;

  return {
    system: [{ type: 'text', text: systemHeader, cache_control: { type: 'ephemeral' } }],
    user: userMessage,
  };
}
