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
};

export const WAIT = {
  appReadyMs: 30_000,
  inputReadyMs: 20_000,
  inputFilledMs: 10_000,
};

export const WA_URL = {
  base: 'https://web.whatsapp.com/',
  send: (phoneE164: string, text: string): string => {
    const digits = phoneE164.replace(/[^\d]/g, '');
    return `https://web.whatsapp.com/send?phone=${digits}&text=${encodeURIComponent(text)}`;
  },
};
