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
