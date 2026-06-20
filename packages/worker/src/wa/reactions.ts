/**
 * Pure reaction-classification logic. WhatsApp Web (2026-06 build) renders a
 * recipient's reaction to our outbound message as a button with
 * aria-label="reaction <emoji>. View reactions" inside the outbound row. The
 * scraper hands the raw aria-labels here; this module extracts the emoji and
 * maps it to an RSVP. No DOM, no I/O — unit-tested.
 */

// Emoji are compared with any VS16 (U+FE0F) presentation selector stripped, so
// "❤️" (U+2764 U+FE0F) and "❤" (U+2764) map to the same entry.
const POSITIVE = new Set([
  '👍', '❤', '🥰', '😍', '🎉', '🙏', '👏', '✅', '💯', '🔥',
  '😊', '😁', '🤩', '🥳', '💖', '💕', '👌',
]);
const NEGATIVE = new Set(['👎', '😢', '😞', '😔', '😟', '😭', '❌', '🚫', '🙁', '☹']);

// U+FE0F = VS16 presentation selector; U+200D = ZWJ (joins compound emoji).
// Written as explicit escapes, never literal invisible characters in source.
function normalizeEmoji(emoji: string): string {
  return emoji.replace(/️/g, '');
}

/** Pulls the emoji run out of a `reaction <emoji>. View reactions` aria-label. */
export function extractReactionEmoji(ariaLabel: string): string | null {
  const m = ariaLabel.match(/reaction\s+([\p{Extended_Pictographic}‍️]+)/u);
  return m ? m[1]! : null;
}

/** Maps a single emoji to an RSVP, or null if it carries no clear signal. */
export function reactionToClassification(emoji: string): 'yes' | 'no' | null {
  const e = normalizeEmoji(emoji);
  if (POSITIVE.has(e)) return 'yes';
  if (NEGATIVE.has(e)) return 'no';
  return null;
}

/**
 * Given the reaction aria-labels scraped from a chat (DOM order, oldest first),
 * pick the most recent one that maps to an RSVP. Returns the classification and
 * the emoji (for the reply summary), or null if none map.
 */
export function chooseReactionRsvp(
  ariaLabels: string[],
): { classification: 'yes' | 'no'; emoji: string } | null {
  let chosen: { classification: 'yes' | 'no'; emoji: string } | null = null;
  for (const label of ariaLabels) {
    const emoji = extractReactionEmoji(label);
    if (!emoji) continue;
    const classification = reactionToClassification(emoji);
    if (classification) chosen = { classification, emoji };
  }
  return chosen;
}

/**
 * Precedence: a real text reply (source 'llm' or 'manual') always wins, so a
 * reaction never overwrites it. A reaction only seeds/refreshes a row when there
 * is no reply or only a prior reaction-sourced one.
 */
export function reactionRsvpDecision(existingSource: string | null): 'upsert' | 'skip' {
  if (existingSource === 'llm' || existingSource === 'manual') return 'skip';
  return 'upsert';
}
