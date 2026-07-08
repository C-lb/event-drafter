/**
 * All DOM selectors for WhatsApp Web in ONE place.
 * When WA changes its markup (it does, multiple times per year),
 * update only this file. Names are stable; implementations are not.
 *
 * Last verified against WA Web build: 2026-07-08 (reaction flow re-tuned live)
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
  // DEPRECATED (pre-2026-06 WA build): the pending-clock icon. WA's 2026-06
  // refresh removed msg-time/msg-check/msg-dblcheck and moved delivery state to
  // an aria-label ("Pending"/"Sent"/"Delivered"/"Read") on the bubble's status
  // node, read in driver.observeSendState via statusTextIsPending. Kept only as
  // a fallback for older WA builds.
  pendingClock: 'span[data-icon="msg-time"]',

  // ===== Reply scraping (added in Plan 5) =====
  // WARNING: these selectors are heuristic. WA does not expose a public DOM
  // contract. Run `npm run wa-smoke` after WA updates to detect drift.
  conversationPane: 'div[role="application"], div[data-tab="8"] [role="row"]',
  messageRow: 'div[role="row"]',
  inboundBubble: 'div.message-in, [data-pre-plain-text]:not([data-pre-plain-text*="From you"])',
  // Outbound detection — WA periodically renames the css class. Try several
  // signals and union the matches:
  //  1. 2026-06 refresh: the message row contains the outbound tail icon
  //     `data-icon="tail-out"` (inbound rows carry `tail-in`). This is the only
  //     signal that survives the refresh — verified live 2026-06-20.
  //  2. Legacy `.message-out` class on the bubble (pre-refresh builds).
  //  3. data-id attribute whose value indicates "from me" (`true_<chat>_<msg>`).
  //  4. `data-pre-plain-text` containing "From you".
  outboundBubble: [
    'div[role="row"]:has([data-icon="tail-out"])',
    'div.message-out',
    'div[class*="message-out"]',
    'div[data-id^="true_"]',
    'div[data-id*="_true_"]',
    '[data-pre-plain-text*="From you"]',
  ].join(', '),
  messageText: 'span.selectable-text, span[dir="ltr"], span[dir="auto"]',
  messageMeta: '[data-pre-plain-text]',

  // ===== Sending a reaction (react-to-reply feature) =====
  // HEURISTIC and unverified against a live WA build — needs one live-tuning
  // pass (see driver.reactToLastInbound). On hovering a message row WA reveals
  // a "React" affordance; clicking it opens a quick-emoji popover. Union a few
  // known signals so a class rename does not break all of them at once.
  // The quick-react affordance revealed on hover. VERIFIED live 2026-07-08:
  // WA renders it as `div[role="button"][aria-label="React"]` (NOT a <button>),
  // so the selector must be tag-agnostic. Do NOT include the context-menu
  // chevron (`[data-js-context-icon]`, aria-label "Open message options") here:
  // it opens a different menu AND it animates ("velocity-animating") so clicks
  // detach mid-action. Clicking this quick-react button opens the emoji popover.
  reactHoverButton:
    '[aria-label="React" i], [aria-label="React to message" i], span[data-icon="reaction"], span[data-icon="status-reaction"]',
  // The quick-reaction popover that appears after clicking react.
  reactionPopover:
    'div[data-animate-reactions-popup], div[data-animate-reaction-popover], [aria-label="Reactions" i]',
};

export const WAIT = {
  appReadyMs: 30_000,
  inputReadyMs: 20_000,
  inputFilledMs: 10_000,
  conversationReadyMs: 15_000,
  // After clicking send: how long to wait for the draft to appear as an
  // outbound bubble without the pending clock before refusing to mark sent.
  sendVerifyMs: 20_000,
};

export const WA_URL = {
  base: 'https://web.whatsapp.com/',
  send: (phoneE164: string, text: string): string => {
    const digits = phoneE164.replace(/[^\d]/g, '');
    return `https://web.whatsapp.com/send?phone=${digits}&text=${encodeURIComponent(text)}`;
  },
};
