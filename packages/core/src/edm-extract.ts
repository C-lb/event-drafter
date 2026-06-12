/**
 * Heuristic extraction of structured facts from an EDM (event direct
 * mailer) body. Date, time, venue, address, dress code, highlights,
 * speakers, registration link. Used by both the client-side preview
 * on /events/new and the server-side summary persisted on the event row.
 *
 * Pure module: no I/O, no Node-only APIs. Safe to import from both
 * server and client bundles.
 */

const LABEL_ALTS =
  '(Date|Time|Venue|Location|Address|Dress\\s*Code|Speakers?|Featured\\s+Speaker|Registration|Register|RSVP)';

/**
 * Real Gmail invites are usually plain text rendered from HTML where the
 * sender used Markdown-style emphasis: `*Date:*\n*3 June 2026*` or
 * `**Venue:** Garibaldi`. Label and value end up on separate lines.
 * Normalise so the value sits next to its label.
 */
export function normalizeEdmBody(text: string): string {
  // Gmail bodies come in with CRLF (or even bare CR) line endings. Strip them
  // first so every subsequent regex can rely on `\n` as the only line break.
  let s = text.replace(/\r\n?/g, '\n');

  // Strip emphasis markers around words: `*Date:*` -> `Date:`, `**Venue:**` -> `Venue:`.
  s = s.replace(/\*+([^*\n]+?)\*+/g, '$1');

  // Same-physical-line labels first: "Wednesday   Time: ..." -> newline before Time.
  // Must run BEFORE the label-on-own-line collapse so the second label gets
  // a chance to be recognised at the start of a line.
  s = s.replace(/([^\n])[ \t]{2,}(Time|Venue|Address|Dress\s*Code|Speakers?|Registration)\s*:/gi, '$1\n$2:');

  // Then collapse "Label:\nValue" into "Label: Value" so single-line regex works.
  const labelOnOwnLine = new RegExp(
    `(^|\\n)[ \\t]*${LABEL_ALTS}\\s*:\\s*\\n[ \\t]*([^\\n]+)`,
    'gi',
  );
  s = s.replace(labelOnOwnLine, (_m, pre, label, value) => `${pre}${label}: ${value}`);

  // Unwrap soft-wrapped narrative lines. Email clients break long sentences
  // at ~75 chars; without unwrapping, regex like `at <Venue>` misses values
  // that span the wrap. Preserve paragraph breaks (blank lines), bullet items,
  // numbered lists, and labelled lines.
  s = s.replace(
    /([^\n])\n(?!\n|[•*\-]|\d+[.)]|\s*(?:Date|Time|Venue|Location|Address|Dress|Speakers?|Featured|Registration|Register|RSVP)\b)/gi,
    '$1 ',
  );

  return s;
}

function titleCaseName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b([a-z])([a-z]*)/g, (_m, a, rest) => a.toUpperCase() + rest)
    // Promote bare "Dr" to "Dr." but skip when there's already a period.
    .replace(/\bDr\b(?!\.)/g, 'Dr.');
}

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

function monthIndex(name: string): number {
  return MONTH_NAMES.indexOf(name.toLowerCase());
}

export interface DateValue { year: number; month: number; day: number }
export interface TimeValue { hour: number; minute: number }
export interface Extracted<T> { value: T; matchStr: string }

export function extractDate(text: string, fallbackYear: number): Extracted<DateValue> | null {
  const longMonth = '(january|february|march|april|may|june|july|august|september|october|november|december)';

  const reFullDay = new RegExp(`\\b(\\d{1,2})\\s+${longMonth}\\s+(\\d{4})\\b`, 'i');
  const mFull = text.match(reFullDay);
  if (mFull) return { value: { day: Number(mFull[1]), month: monthIndex(mFull[2]!), year: Number(mFull[3]) }, matchStr: mFull[0] };

  const reMonthFirst = new RegExp(`\\b${longMonth}\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, 'i');
  const mMonth = text.match(reMonthFirst);
  if (mMonth) return { value: { day: Number(mMonth[2]), month: monthIndex(mMonth[1]!), year: Number(mMonth[3]) }, matchStr: mMonth[0] };

  const reNoYear = new RegExp(`\\b(\\d{1,2})\\s+${longMonth}\\b`, 'i');
  const mNoYear = text.match(reNoYear);
  if (mNoYear) return { value: { day: Number(mNoYear[1]), month: monthIndex(mNoYear[2]!), year: fallbackYear }, matchStr: mNoYear[0] };

  const reIso = text.match(/\b(\d{4})[/-](\d{1,2})[/-](\d{1,2})\b/);
  if (reIso) return { value: { year: Number(reIso[1]), month: Number(reIso[2]) - 1, day: Number(reIso[3]) }, matchStr: reIso[0] };

  const reSlashDmy = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/);
  if (reSlashDmy) return { value: { day: Number(reSlashDmy[1]), month: Number(reSlashDmy[2]) - 1, year: Number(reSlashDmy[3]) }, matchStr: reSlashDmy[0] };

  return null;
}

function parseTime(token: string): TimeValue | null {
  const m = token.trim().match(/^(\d{1,2})(?::|\.)?(\d{2})?\s*(am|pm)?$/i);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  const meridiem = m[3]?.toLowerCase();
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

export function extractTime(text: string): Extracted<TimeValue> | null {
  // "12:00 PM to 2:00 PM", "12:00 PM – 2:00 PM", "7.00PM - 9.00PM", "12:00PM-2:00PM"
  const range = text.match(/(\d{1,2}[:.]?\d{0,2}\s*(?:am|pm))\s*(?:–|—|-|to|until)\s*(\d{1,2}[:.]?\d{0,2}\s*(?:am|pm))/i);
  if (range) {
    const t = parseTime(range[1]!);
    if (t) return { value: t, matchStr: range[0] };
  }

  // "12:00 PM" standalone (requires colon/dot + minutes, prevents matching
  // years like "2025").
  const single = text.match(/\b(\d{1,2}[:.]\d{2}\s*(?:am|pm))\b/i);
  if (single) {
    const t = parseTime(single[1]!);
    if (t) return { value: t, matchStr: single[0] };
  }
  return null;
}

export function extractVenue(text: string): Extracted<string> | null {
  // Labelled line: "Venue: X" / "Location: X"
  const tagged = text.match(/(?:^|\n)\s*(?:Venue|Location)\s*[:\-]\s*([^\n\r|;]+?)(?:\s+\bon\b|[|;\n\r]|$)/i);
  if (tagged) {
    const value = tagged[1]!.trim().replace(/[•\-:\s]+$/, '');
    if (value) return { value, matchStr: tagged[0] };
  }

  // "at <Venue Name>" — venue follows the word "at", begins capitalised.
  const atMatch = text.match(/\bat\s+([A-Z][A-Za-z0-9 &',.\-]{3,80}?)(?:\s+(?:on|from|for|tomorrow|today|where|located|to celebrate|with)|[.,\n\r]|$)/);
  if (atMatch) {
    const value = atMatch[1]!.trim().replace(/[\s,.]+$/, '');
    if (value) return { value, matchStr: atMatch[0] };
  }

  return null;
}

export function extractAddress(text: string): Extracted<string> | null {
  const m = text.match(/(?:^|\n)\s*Address\s*[:\-]\s*([^\n\r|;]+)/i);
  if (m) {
    const value = m[1]!.trim();
    if (value) return { value, matchStr: m[0] };
  }
  return null;
}

export function extractDressCode(text: string): Extracted<string> | null {
  const m = text.match(/(?:^|\n)\s*Dress\s*(?:Code)?\s*[:\-]\s*([^\n\r|;]+)/i);
  if (m) {
    const value = m[1]!.trim();
    if (value) return { value, matchStr: m[0] };
  }
  return null;
}

export function extractRegistrationLink(text: string): string | null {
  // Prefer known short / form hosts so we skip past Gmail's urldefense
  // safelink wrapper to the actual registration page.
  const knownHosts = ['forms\\.gle', 'bit\\.ly', 'lu\\.ma', 'eventbrite\\.com', 'tinyurl\\.com'];
  for (const host of knownHosts) {
    const re = new RegExp(`${host}/[A-Za-z0-9_./-]+`, 'i');
    const m = text.match(re);
    if (m) return m[0].replace(/[.,)\]]+$/, '');
  }
  const url = text.match(/\bhttps?:\/\/[^\s<>"')]+/i);
  if (url) return url[0].replace(/[.,)\]]+$/, '');
  return null;
}

/**
 * Pulls bullet items from a "Highlights" / "Programme" / "Program Highlights"
 * section. Recognises `•`, `*`, `-`, `–` bullets, indented or not. Stops at
 * the next blank line or labelled line (Date:, Time:, etc).
 */
export function extractHighlights(text: string): string[] {
  const headerRe = /(?:^|\n)\s*(?:Key\s+)?(?:Program(?:me)?\s+)?Highlights?\s*[:\-]?\s*\n/i;
  const m = text.match(headerRe);
  if (!m) return [];
  const startIdx = m.index! + m[0].length;
  const rest = text.slice(startIdx);
  const lines = rest.split('\n');
  const items: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (items.length > 0) break;
      continue;
    }
    if (/^(date|time|venue|address|dress|speakers?|panel|registration)\s*[:\-]/i.test(line)) break;
    const bullet = line.match(/^[•*\-–]\s*(.+)$/);
    if (bullet) {
      items.push(bullet[1]!.trim());
    } else if (items.length === 0) {
      // Non-bulleted line right after the header — likely paragraph, skip.
      continue;
    } else {
      break;
    }
  }
  return items.filter((s) => s.length > 0).slice(0, 8);
}

/**
 * Pulls speaker names from any of:
 *   - "Speakers: A, B, C"
 *   - "panel of speakers from leading organisations, such as A, B, C and others"
 *   - SPARK-style "FEATURED SPEAKER\n\nDR. TOM LEIGHTON" block (one name in caps
 *     on its own line, optionally preceded by emphasis markers).
 */
export function extractSpeakers(text: string): string[] {
  const tagged = text.match(/(?:^|\n)\s*Speakers?\s*[:\-]\s*([^\n\r]+)/i);
  if (tagged) {
    return splitNameList(tagged[1]!);
  }
  const panel = text.match(/panel of speakers[^.\n]*?(?:such as|including)\s+([^.\n]+)/i);
  if (panel) {
    return splitNameList(panel[1]!);
  }
  const featured = text.match(/FEATURED\s+SPEAKERS?\s*[:\-]?\s*\n+\s*([A-Z][A-Z. ]{4,80}[A-Z])/);
  if (featured) {
    return [titleCaseName(featured[1]!)];
  }
  return [];
}

function splitNameList(s: string): string[] {
  return s
    .replace(/\band others\b.*$/i, '')
    .split(/,(?:\s+and\s+)?|\s+and\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0)
    .slice(0, 10);
}

export interface EdmSummary {
  date_local: string | null;       // "YYYY-MM-DDTHH:MM" for <input type="datetime-local">
  date_long: string | null;        // "Thursday, 27 February 2025"
  time_str: string | null;         // "12:00 PM – 2:00 PM" (raw matched range or single)
  venue: string | null;
  address: string | null;
  dress_code: string | null;
  highlights: string[];
  speakers: string[];
  registration: string | null;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toDateTimeLocal(d: DateValue, t: TimeValue): string {
  return `${d.year}-${pad2(d.month + 1)}-${pad2(d.day)}T${pad2(t.hour)}:${pad2(t.minute)}`;
}

function toLongDate(d: DateValue): string {
  const dt = new Date(d.year, d.month, d.day);
  return dt.toLocaleDateString('en-SG', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

export function extractEdmSummary(body: string, subject: string, fallbackYear: number): EdmSummary {
  const norm = normalizeEdmBody(body);
  const text = `${subject}\n${norm}`;
  const d = extractDate(text, fallbackYear);
  const t = extractTime(text);
  const venue = extractVenue(text);
  const address = extractAddress(norm);
  const dress = extractDressCode(norm);
  const highlights = extractHighlights(norm);
  const speakers = extractSpeakers(norm);
  const registration = extractRegistrationLink(norm);

  return {
    date_local: d ? toDateTimeLocal(d.value, t?.value ?? { hour: 9, minute: 0 }) : null,
    date_long: d ? toLongDate(d.value) : null,
    // Collapse stray internal whitespace (line breaks from wrapped narrative
    // text) so the displayed string stays on one line.
    time_str: t?.matchStr.replace(/\s+/g, ' ').trim() ?? null,
    venue: venue?.value ?? null,
    address: address?.value ?? null,
    dress_code: dress?.value ?? null,
    highlights,
    speakers,
    registration,
  };
}

/**
 * Renders the extracted summary as a compact "Event facts" block intended
 * to be injected into the LLM prompt and surfaced to the operator for review.
 * Empty fields are omitted entirely.
 */
export function renderEdmSummary(s: EdmSummary): string {
  const lines: string[] = [];
  if (s.date_long) lines.push(`Date: ${s.date_long}`);
  if (s.time_str) lines.push(`Time: ${s.time_str}`);
  if (s.venue) lines.push(`Venue: ${s.venue}`);
  if (s.address) lines.push(`Address: ${s.address}`);
  if (s.dress_code) lines.push(`Dress code: ${s.dress_code}`);
  if (s.speakers.length > 0) lines.push(`Speakers: ${s.speakers.join(', ')}`);
  if (s.registration) lines.push(`Registration: ${s.registration}`);
  if (s.highlights.length > 0) {
    lines.push('Highlights:');
    for (const h of s.highlights) lines.push(`  • ${h}`);
  }
  return lines.join('\n');
}

export function summarizeEdm(body: string, subject: string, fallbackYear: number): string {
  return renderEdmSummary(extractEdmSummary(body, subject, fallbackYear));
}
