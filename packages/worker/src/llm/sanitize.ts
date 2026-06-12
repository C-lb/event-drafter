/**
 * Post-process LLM draft output to scrub the most common "AI tells" that
 * make the message sound machine-written. The prompt already forbids these
 * things, but models still slip — this is the deterministic safety net.
 *
 * Scope: punctuation substitution + whitespace collapsing. No semantic
 * rewrites (we won't try to paraphrase "I trust this finds you well" into
 * something better; that would change meaning). Voice fixes belong upstream
 * in the prompt; this layer enforces only the easy mechanical rules.
 */

/**
 * Replace em-dashes (—) and en-dashes (–) with safer punctuation. The
 * heuristic:
 *   "word — word"   → "word, word"     (most common pause use)
 *   "word—word"     → "word, word"     (no spaces around it)
 *   leading "— "    → ""               (sometimes models open with one)
 *   trailing " —"   → ""
 */
function replaceDashes(text: string): string {
  // Drop a leading dash (with optional whitespace) — e.g. "— Looking forward".
  let out = text.replace(/^\s*[—–]\s*/gm, '');
  // Drop a trailing dash — e.g. "see you then —".
  out = out.replace(/\s*[—–]\s*$/gm, '');
  // Replace spaced inline dashes with a comma + single space.
  out = out.replace(/\s+[—–]\s+/g, ', ');
  // Replace any remaining flush dashes (rare) with a comma + space.
  out = out.replace(/[—–]/g, ', ');
  return out;
}

/**
 * Collapse double spaces that the dash replacement can introduce (e.g. when
 * the original was "word — word." → "word, word.", fine; but if anything
 * else accidentally creates "word ,  word", clean it up).
 */
function cleanupWhitespace(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, ' ')           // collapse runs of spaces/tabs
    .replace(/ ,/g, ',')                   // " ," → ","
    .replace(/,{2,}/g, ',')                // ",," → ","
    .replace(/\n{3,}/g, '\n\n');           // 3+ newlines → 2
}

/**
 * Apply all sanitization passes. Called immediately after `complete()`
 * returns LLM text for any draft destined for a human recipient (invites,
 * reply responses, follow-ups). Idempotent.
 */
export function sanitizeDraft(text: string): string {
  return cleanupWhitespace(replaceDashes(text)).trim();
}
