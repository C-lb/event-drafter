import type { PromptBlock } from './client.js';
import type { Contact, Event } from '@vip/core';

export interface AttendanceFact {
  event_name: string;
  event_date: Date;
  attended: boolean;
  notes: string | null;
}

export interface DraftPromptInput {
  event: Pick<Event, 'name' | 'event_date' | 'venue' | 'edm_subject' | 'edm_body'>;
  contact: Pick<Contact, 'full_name' | 'preferred_name' | 'personal_note' | 'interests'>;
  attendance_history: AttendanceFact[];
  style_guide: string;
  operator_first_name?: string;
}

const PROMPT_VERSION = 'v1';

const GENERIC_RULES = `You are drafting a personal WhatsApp invitation message that will be reviewed and manually sent by the operator. Output ONLY the message body — no greeting metadata, no "Here is the message:", no quotes around the message, no Markdown formatting.

Hard rules:
- 2-4 sentences. Hard cap.
- Use the supplied personal hook naturally in one sentence; do not list interests like a CV.
- If attendance history is supplied, you may reference at most ONE prior event lightly.
- Do not repeat the formal EDM verbatim — assume the recipient will also receive that email separately.
- Output plain text. No emoji unless the style guide explicitly allows them.`;

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

## Formal invitation (EDM) for reference

Subject: ${input.event.edm_subject ?? '(none)'}

${input.event.edm_body ?? '(no EDM body supplied — keep the message generic about the event)'}

# Operator
${input.operator_first_name ? `Sign off with: "${input.operator_first_name}"` : 'Sign off with the operator\'s first name (assume they will edit if wrong).'}

# Prompt version: ${PROMPT_VERSION}`;

  const attendanceLines = input.attendance_history.length
    ? input.attendance_history
        .map((f) => `- ${f.event_name} (${new Date(f.event_date).toISOString().slice(0, 10)}): ${f.attended ? 'attended' : 'did not attend'}${f.notes ? ` — ${f.notes}` : ''}`)
        .join('\n')
    : '(no prior events on record)';

  const userMessage = `# Contact

Full name: ${input.contact.full_name}
Preferred name: ${input.contact.preferred_name ?? input.contact.full_name.split(' ')[0]}
Personal hook: ${input.contact.personal_note ?? '(none — keep the message warm but generic)'}
Interests: ${input.contact.interests ?? '(none)'}

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
  contact: Pick<Contact, 'full_name' | 'preferred_name' | 'personal_note'>;
  original_invite_text: string;
  reply_text: string;
  style_guide: string;
  operator_first_name?: string;
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

The response_draft must be brief, match the supplied style guide, and not promise anything specific (no times, no logistics) unless the reply asked for it.`;

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
Venue: ${input.event.venue ?? '(not specified)'}

# Operator
${input.operator_first_name ? `Sign off responses with: "${input.operator_first_name}"` : 'Sign off with the operator\'s first name.'}`;

  const userMessage = `# Contact
Name: ${input.contact.full_name} (preferred: ${input.contact.preferred_name ?? input.contact.full_name.split(' ')[0]})
Personal hook: ${input.contact.personal_note ?? '(none)'}

# Original invitation we sent
${input.original_invite_text}

# Their reply
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
  return { classification: c, confidence, summary, response_draft };
}
