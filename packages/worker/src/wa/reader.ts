import type { Page } from 'playwright';
import { SEL, WA_URL, WAIT } from './selectors.js';
import { detectLoginState, WaNotLoggedIn, WaSelectorMismatch } from './session.js';
import { logger } from '../logger.js';

export interface InboundMessage {
  wa_message_id: string | null;
  wa_sent_at: Date;
  text: string;
}

/** Raw row pulled from the DOM by openChatAndReadInbound. Exported for tests. */
export interface ChatRow {
  meta: string | null;
  text: string;
  isInbound: boolean;
  dataId: string | null;
}

/**
 * Untouched row data harvested from the DOM, before direction classification.
 * Exported so the page-eval payload and the Node-side `classifyRow` agree on
 * the shape.
 */
export interface RawRow {
  meta: string;
  text: string;
  dataIdRaw: string;
  cssOutbound: boolean;
}

/** Last 7 digits of a phone is robust across WA's various formattings. */
const PHONE_TAIL_LEN = 7;

function phoneTail(phoneE164: string | undefined): string {
  if (!phoneE164) return '';
  const digits = phoneE164.replace(/\D/g, '');
  return digits.slice(-PHONE_TAIL_LEN);
}

/**
 * Decides whether a raw row is inbound or outbound.
 *
 * Direction signal priority (highest confidence first):
 *  1. `data-id` wrapper prefix — `true_*` (sent by us) / `false_*` (received).
 *     This was WhatsApp's message-id storage model pre-2026-06. WA dropped it
 *     mid-2026 (the `data-id` is now a bare message id), but it's kept first:
 *     cheap, definitive when present, and forward-safe if WA reverts.
 *  2. Message-id prefix `3EB0` — WhatsApp stamps this on every message the
 *     local client SENDS; received messages carry server ids with other
 *     prefixes (e.g. `3A…`). Verified live 2026-06-17. This is the durable
 *     OUTBOUND signal on current builds, where the `true_/false_` wrapper and
 *     the `.message-out` class are both gone and our own messages render with
 *     author = the operator's profile name (not "You"). Only `3EB0` proves
 *     outbound; its absence is NOT proof of inbound, so we fall through.
 *  3. Author tail equals "You" or "From you" appears in meta — outbound.
 *  4. Author tail matches the contact's display name (word-bounded, case
 *     insensitive) — inbound. Handles saved contacts.
 *  5. Author tail's digits end with the last 7 of the contact's phone —
 *     inbound. Handles UNSAVED contacts where WA shows the phone in place of
 *     a name (the bug this addresses).
 *  6. CSS class `.message-out` — outbound (legacy, drifts).
 *  7. Ambiguous → INBOUND by default. The walk-back stops on the first
 *     outbound row, so misclassifying a noise row as inbound at worst adds
 *     junk that the per-invite date filter in check-replies drops, whereas
 *     misclassifying as outbound silently buries the rest of the thread.
 */
export function classifyRow(
  raw: RawRow,
  contactDisplayName: string | undefined,
  phoneE164: string | undefined,
): { isInbound: boolean } {
  const id = raw.dataIdRaw;
  if (id.startsWith('false_') || id.includes('_false_')) return { isInbound: true };
  if (id.startsWith('true_') || id.includes('_true_')) return { isInbound: false };

  // `3EB0` = locally-generated outgoing message id. Present on our own
  // messages, never on received ones. The single durable outbound signal on
  // post-2026-06 WA builds.
  if (/(^|_)3eb0/i.test(id)) return { isInbound: false };

  const authorMatch = raw.meta.match(/^\[[^\]]+\]\s+([^:]+):/);
  const author = authorMatch?.[1]?.trim() ?? '';

  if (/^you$/i.test(author) || /\bFrom you\b/i.test(raw.meta)) return { isInbound: false };

  if (contactDisplayName) {
    const escaped = contactDisplayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${escaped}\\b`, 'i').test(author)) return { isInbound: true };
  }

  const tail = phoneTail(phoneE164);
  if (tail) {
    const authorDigits = author.replace(/\D/g, '');
    if (authorDigits.endsWith(tail)) return { isInbound: true };
  }

  if (raw.cssOutbound) return { isInbound: false };

  return { isInbound: true };
}

/**
 * Parse a WhatsApp `data-pre-plain-text` value like
 *   "[2:14 PM, 6/10/2026] Ada Lovelace: "
 *   "[14:14, 10/06/2026] Ada: "          (en-SG / en-GB)
 *   "[14:14, 6/10/2026 ] Ada: "
 * Returns the timestamp and author. When the date ordering is ambiguous we
 * prefer day-first (Singapore convention) and fall back to month-first via
 * `Date.parse`. Unrecoverable inputs return `ts: null` so downstream code can
 * treat the message as undated rather than silently using "now".
 */
export function parsePrePlainText(value: string): { ts: Date | null; author: string | null } {
  const m = value.match(/^\[([^\]]+)\]\s+([^:]+):/);
  if (!m) return { ts: null, author: null };
  const inside = m[1]!.trim();
  const author = m[2]!.trim();

  // Try an explicit "HH:MM (am|pm)?, dd/mm/yyyy" parse first so we get the
  // right date when day-first ambiguity bites Date.parse.
  const explicit = inside.match(
    /^(\d{1,2})[:.](\d{2})\s*(am|pm)?,?\s*(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/i,
  );
  if (explicit) {
    let hour = Number(explicit[1]);
    const minute = Number(explicit[2]);
    const meridiem = explicit[3]?.toLowerCase();
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    const a = Number(explicit[4]);
    const b = Number(explicit[5]);
    let year = Number(explicit[6]);
    if (year < 100) year += 2000;
    // Prefer day-first (Singapore). If `a > 12` it MUST be day; if `b > 12`
    // it must be month so we swap. Otherwise (both ≤ 12) day-first wins.
    let day = a;
    let month = b;
    if (a <= 12 && b > 12) {
      day = b;
      month = a;
    }
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && hour <= 23 && minute <= 59) {
      return { ts: new Date(year, month - 1, day, hour, minute), author };
    }
  }

  // Fall back to JS Date.parse with a couple of comma-stripping variants.
  for (const c of [inside.replace(',', ''), inside.replace(/,\s+/, ' ')]) {
    const t = Date.parse(c);
    if (!Number.isNaN(t)) return { ts: new Date(t), author };
  }
  return { ts: null, author };
}

/**
 * Walks `rows` (oldest → newest, as the DOM provides them) backwards from the
 * tail and collects every inbound message until the first outbound row. That
 * outbound row is treated as the anchor — our last sent message — and
 * everything before it is ignored.
 *
 * Returns the inbound thread chronologically (oldest first). If no outbound
 * row is present, every inbound row is returned.
 */
export function collectThreadSinceLastOutbound(rows: ChatRow[]): InboundMessage[] {
  const collected: InboundMessage[] = [];
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]!;
    if (!r.isInbound) {
      // Found our last outbound message — stop walking.
      break;
    }
    if (!r.text || !r.meta) continue;
    const { ts } = parsePrePlainText(r.meta);
    collected.push({
      wa_message_id: r.dataId,
      // Unparseable timestamps must NOT default to "now" — that would silently
      // bypass the per-invite date filter in check-replies. Sentinel epoch 0
      // makes the filter reject the message and surfaces the parse failure
      // in logs instead of polluting the joined reply text.
      wa_sent_at: ts ?? new Date(0),
      text: r.text,
    });
  }
  // We walked newest → oldest; flip to chronological.
  return collected.reverse();
}

/**
 * Opens a WA chat for the given phone and returns the inbound messages that
 * arrived AFTER our most recent outbound message (the invite or follow-up
 * we sent). Caller is expected to join them into a single reply.
 *
 * Pass `contactDisplayName` (the recipient's first name as we have it in
 * `contacts.first_name`) so we can fall back to author-vs-contact name
 * matching when WA's CSS class signals fail. WA's `.message-out` selector
 * drifts often; the author tail in `data-pre-plain-text` is more stable.
 *
 * No history scroll-back. Does not return every inbound message in the chat.
 */
export interface ReadOpts {
  /**
   * When true, skip the per-call WA.base goto + login state check. Use this
   * inside batch loops (e.g. check_replies) where the caller has already
   * verified login once. Saves 1–2s per contact by avoiding a redundant
   * navigation to the WA home tab between chats.
   */
  skipPrelude?: boolean;
}

export async function openChatAndReadInbound(
  page: Page,
  phoneE164: string,
  contactDisplayName?: string,
  opts: ReadOpts = {},
): Promise<InboundMessage[]> {
  if (!opts.skipPrelude) {
    await page.goto(WA_URL.base, { waitUntil: 'domcontentloaded' });
    if ((await detectLoginState(page)) !== 'logged-in') throw new WaNotLoggedIn();
  }

  const url = WA_URL.send(phoneE164, '');
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  try {
    await page.waitForSelector(SEL.messageInputBox, { timeout: WAIT.conversationReadyMs });
  } catch {
    throw new WaSelectorMismatch('messageInputBox not found when opening chat');
  }

  // Condition-based wait: proceed as soon as a message row materialises (or
  // after 800ms, whichever first). Chats with zero history short-circuit;
  // chats whose DOM is already populated don't pay the fixed delay.
  await page.waitForSelector(SEL.messageRow, { timeout: 800 }).catch(() => null);

  // Page-eval is purely a DOM scraper now. Direction classification happens
  // Node-side in `classifyRow` so it stays testable and the priority order
  // (data-id → author name → phone tail → css → default-inbound) is in one
  // place. See classifyRow's doc comment for why.
  const rawRows: RawRow[] = await page.$$eval(SEL.messageRow, (rowEls, selectors) => {
    const out: { meta: string; text: string; dataIdRaw: string; cssOutbound: boolean }[] = [];
    for (const row of rowEls) {
      const metaEl = row.querySelector(selectors.messageMeta);
      const meta = metaEl ? metaEl.getAttribute('data-pre-plain-text') : null;
      if (!meta) continue;

      const textEl = row.querySelector(selectors.messageText);
      const text = textEl ? (textEl.textContent ?? '').trim() : '';
      if (!text) continue;

      const dataIdRaw = row.querySelector('[data-id]')?.getAttribute('data-id') ?? '';
      const cssOutbound = row.querySelector(selectors.outboundBubble) !== null;

      out.push({ meta, text, dataIdRaw, cssOutbound });
    }
    return out;
  }, {
    outboundBubble: SEL.outboundBubble,
    messageMeta: SEL.messageMeta,
    messageText: SEL.messageText,
  });

  const rows: ChatRow[] = rawRows.map((r) => ({
    meta: r.meta,
    text: r.text,
    dataId: r.dataIdRaw || null,
    isInbound: classifyRow(r, contactDisplayName, phoneE164).isInbound,
  }));

  const thread = collectThreadSinceLastOutbound(rows);
  logger.info('wa: read reply thread', {
    phone: phoneE164,
    rows: rows.length,
    inbound: rows.filter((r) => r.isInbound).length,
    threadLen: thread.length,
  });
  return thread;
}

const THREAD_JOINER = '\n— next message —\n';

/** Joins multiple inbound messages chronologically into one reply text. */
export function joinThreadText(messages: { text: string }[]): string {
  return messages.map((m) => m.text.trim()).filter(Boolean).join(THREAD_JOINER);
}
