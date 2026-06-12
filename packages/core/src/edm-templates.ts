/**
 * Starter draft templates used on the event details page. Each renders
 * with summary data already substituted so the operator can copy a draft
 * verbatim and paste into WhatsApp — no per-contact personalisation
 * beyond editing the body text itself.
 *
 * These mirror the SPARK voice in templates/draft-messages.md (sections
 * A, C, D). Recipient salutation is intentionally `[name]` — the operator
 * replaces it at send time.
 */

import type { EdmSummary } from './edm-extract.js';

export interface StarterDraftInput {
  event_name: string;
  event_date: Date;
  summary: EdmSummary;
  operator_first_name: string;
  operator_role: string;
}

export interface StarterDraft {
  kind: 'long_invite' | 'day_of_reminder' | 'gentle_follow_up';
  title: string;
  description: string;
  body: string;
  missing_facts: string[];
}

function or(value: string | null | undefined, label: string, missing: string[]): string {
  if (value && value.trim()) return value.trim();
  missing.push(label);
  return `[${label}]`;
}

function timeOfDayGreeting(eventDate: Date): 'Good morning' | 'Good afternoon' {
  // SPARK voice: "Good morning" before 12:00 SGT, "Good afternoon" from 12:00.
  const hours = eventDate.getHours();
  return hours < 12 ? 'Good morning' : 'Good afternoon';
}

function joinHighlights(items: string[]): string {
  if (!items.length) return '';
  return items.map((h) => `• ${h}`).join('\n');
}

function joinSpeakerNames(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function signature(input: StarterDraftInput): string {
  return `Regards,\n${input.operator_first_name}\n${input.operator_role}`;
}

/**
 * Template A — long-form fresh invitation. Mirrors templates/draft-messages.md §A
 * but warmer, with em dashes replaced by periods or commas so the text reads as
 * something a real person would type on WhatsApp.
 */
function buildLongInvite(input: StarterDraftInput): StarterDraft {
  const missing: string[] = [];
  const greet = timeOfDayGreeting(input.event_date);
  const date = or(input.summary.date_long, 'date', missing);
  const time = or(input.summary.time_str, 'time', missing);
  const venue = or(input.summary.venue, 'venue', missing);
  const speakers = joinSpeakerNames(input.summary.speakers);
  const highlights = joinHighlights(input.summary.highlights);
  const link = input.summary.registration ?? null;

  const speakerLine = speakers
    ? `Speakers from leading organisations include ${speakers}, sharing their insights and experience on the day.`
    : '';

  const highlightBlock = highlights ? `A few highlights from the programme:\n\n${highlights}` : '';

  const linkLine = link
    ? `More info and the registration link are here: ${link}`
    : 'An email invitation has also been sent to you.';

  const body = [
    `${greet} [name],`,
    `Would love to have you join us at our ${input.event_name} on ${date}, from ${time}, at ${venue}.`,
    speakerLine,
    highlightBlock,
    linkLine,
    'Looking forward to having you.',
    signature(input),
  ]
    .filter((s) => s.trim())
    .join('\n\n');

  return {
    kind: 'long_invite',
    title: 'Long invitation',
    description: 'Flagship-style fresh invite. Use for first-touch sends on keynote events.',
    body,
    missing_facts: missing,
  };
}

/**
 * Template C — day-of / day-before reminder. Mirrors templates/draft-messages.md §C
 * with a warmer opener and no em dashes.
 */
function buildDayOfReminder(input: StarterDraftInput): StarterDraft {
  const missing: string[] = [];
  const date = or(input.summary.date_long, 'date', missing);
  const time = or(input.summary.time_str, 'time', missing);
  const venue = or(input.summary.venue, 'venue', missing);
  const address = or(input.summary.address, 'address', missing);
  const dress = or(input.summary.dress_code, 'dress code', missing);

  const body = [
    `Good morning [name],`,
    `Quick reminder that we look forward to hosting you at our ${input.event_name} tomorrow.`,
    `Here are the details for easy reference:\n\nDate: ${date}\nTime: ${time}\nVenue: ${venue}\nAddress: ${address}\nDress Code: ${dress}`,
    `See you there.`,
    signature(input),
  ].join('\n\n');

  return {
    kind: 'day_of_reminder',
    title: 'Day-before reminder',
    description: 'Logistics reconfirmation the day before. Swap "tomorrow" for "today" on the day.',
    body,
    missing_facts: missing,
  };
}

/**
 * Template D — gentle follow-up for non-responders. Mirrors templates/draft-messages.md §D.
 * No em dash on the opener; never calls out the silence directly.
 */
function buildGentleFollowUp(input: StarterDraftInput): StarterDraft {
  const missing: string[] = [];
  const date = or(input.summary.date_long, 'date', missing);
  const venue = or(input.summary.venue, 'venue', missing);
  const greet = timeOfDayGreeting(input.event_date);
  const link = input.summary.registration ?? null;

  const linkLine = link
    ? `If timing doesn't work, no worries at all. The registration link is here for your convenience: ${link}`
    : `If timing doesn't work, no worries at all.`;

  const body = [
    `${greet} [name],`,
    `Just floating this back up in case it was missed. Our ${input.event_name} is on ${date} at ${venue}, would be lovely to have you there.`,
    linkLine,
    signature(input),
  ].join('\n\n');

  return {
    kind: 'gentle_follow_up',
    title: 'Gentle follow-up',
    description: 'For non-responders. Never calls out the silence directly.',
    body,
    missing_facts: missing,
  };
}

export function renderStarterDrafts(input: StarterDraftInput): StarterDraft[] {
  return [
    buildLongInvite(input),
    buildDayOfReminder(input),
    buildGentleFollowUp(input),
  ];
}
