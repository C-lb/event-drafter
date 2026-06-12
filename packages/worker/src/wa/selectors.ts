/**
 * All DOM selectors for WhatsApp Web in ONE place.
 * When WA changes its markup (it does, multiple times per year),
 * update only this file. Names are stable; implementations are not.
 *
 * Last verified against WA Web build: 2026-06-10
 */

export const SEL = {
  qrCanvas: 'canvas[aria-label*="Scan"], canvas[role="img"]',
  chatListPane: '[aria-label="Chat list"], div[role="grid"][aria-label*="Chat"]',
  messageInputBox: 'div[contenteditable="true"][data-tab="10"], footer div[contenteditable="true"]',
  invalidNumberDialog: 'text=/phone number shared via url is invalid/i, text=/invalid phone number/i',
  useHereButton: 'role=button[name=/use here/i]',
  loadingSpinner: 'div[data-icon="progress"], svg[aria-label="Loading"]',
  // Compose-area send button. WA Web renders it as the airplane icon on the
  // right of the input box. Matches both the aria-label and the data-icon.
  sendButton: 'footer button[aria-label="Send" i], footer span[data-icon="send"]',

  // ===== Reply scraping (added in Plan 5) =====
  // WARNING: these selectors are heuristic. WA does not expose a public DOM
  // contract. Run `npm run wa-smoke` after WA updates to detect drift.
  conversationPane: 'div[role="application"], div[data-tab="8"] [role="row"]',
  messageRow: 'div[role="row"]',
  inboundBubble: 'div.message-in, [data-pre-plain-text]:not([data-pre-plain-text*="From you"])',
  // Outbound detection — WA periodically renames the css class. Try several
  // signals and union the matches:
  //  1. Legacy `.message-out` class on the bubble.
  //  2. data-id attribute on the bubble whose value indicates "from me"
  //     (the format used since ~2022 is `true_<chat>_<msg>` for outbound).
  //  3. New obfuscated classes that still co-occur with the outbound tail.
  outboundBubble: [
    'div.message-out',
    'div[class*="message-out"]',
    'div[data-id^="true_"]',
    'div[data-id*="_true_"]',
    '[data-pre-plain-text*="From you"]',
  ].join(', '),
  messageText: 'span.selectable-text, span[dir="ltr"], span[dir="auto"]',
  messageMeta: '[data-pre-plain-text]',
};

export const WAIT = {
  appReadyMs: 30_000,
  inputReadyMs: 20_000,
  inputFilledMs: 10_000,
  conversationReadyMs: 15_000,
};

export const WA_URL = {
  base: 'https://web.whatsapp.com/',
  send: (phoneE164: string, text: string): string => {
    const digits = phoneE164.replace(/[^\d]/g, '');
    return `https://web.whatsapp.com/send?phone=${digits}&text=${encodeURIComponent(text)}`;
  },
};
