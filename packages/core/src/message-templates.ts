export interface MergeContext {
  first_name: string;
  last_name?: string | null;
  event_name: string;
  event_date: Date;
  venue?: string | null;
  food_pref?: string | null;
  chauffeured: boolean;
  parking_coupon: boolean;
  takes_bus: boolean;
}

/** Fixed phrases a toggle token expands to when the toggle is on (MVP defaults). */
export const TOGGLE_PHRASES = {
  parking: "We'll send you a parking coupon closer to the date.",
  bus: "You're on our shuttle, we'll share pickup details soon.",
  chauffeur: "We'll arrange a car to bring you to the venue.",
} as const;

const DATE_FMT: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric' };

/**
 * Render a merge-field template deterministically for one contact. Unknown
 * tokens are left verbatim so typos surface. Output is tidied: em dashes
 * stripped (house rule), and blank lines / double spaces left by empty tokens
 * collapsed.
 */
export function renderMessageTemplate(body: string, ctx: MergeContext): string {
  const tokens: Record<string, string> = {
    first_name: ctx.first_name,
    last_name: ctx.last_name ?? '',
    event_name: ctx.event_name,
    event_date: new Date(ctx.event_date).toLocaleDateString('en-SG', DATE_FMT),
    venue: ctx.venue ?? '',
    food_pref: ctx.food_pref ?? '',
    parking: ctx.parking_coupon ? TOGGLE_PHRASES.parking : '',
    bus: ctx.takes_bus ? TOGGLE_PHRASES.bus : '',
    chauffeur: ctx.chauffeured ? TOGGLE_PHRASES.chauffeur : '',
  };
  const filled = body.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in tokens ? tokens[key]! : whole,
  );
  return tidy(filled);
}

function tidy(text: string): string {
  return text
    .replace(/[—–]/g, ', ')       // strip em/en dashes (house rule)
    .replace(/[ \t]+\n/g, '\n')    // trailing spaces before a newline
    .replace(/\n[ \t]+/g, '\n')    // leading spaces after a newline
    .replace(/[ \t]{2,}/g, ' ')    // collapse runs of spaces
    .replace(/\n{2,}/g, '\n')      // an empty toggle line leaves a blank line -> collapse
    .replace(/ ,/g, ',')
    .replace(/,{2,}/g, ',')
    .trim();
}

/** Name for a saved template: first non-empty line, capped, or a fallback. */
export function deriveTemplateName(body: string, fallback = 'Untitled template'): string {
  const firstLine = body.split('\n').map((l) => l.trim()).find((l) => l.length > 0);
  if (!firstLine) return fallback;
  return firstLine.length > 60 ? firstLine.slice(0, 60) : firstLine;
}
