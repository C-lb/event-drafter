import type { Page } from 'playwright';
import { SEL, WA_URL, WAIT } from './selectors.js';
import { detectLoginState, WaNotLoggedIn, WaSelectorMismatch } from './session.js';
import { logger } from '../logger.js';

export interface InboundMessage {
  wa_message_id: string | null;
  wa_sent_at: Date;
  text: string;
}

export function parsePrePlainText(value: string): { ts: Date | null; author: string | null } {
  const m = value.match(/^\[([^\]]+)\]\s+([^:]+):/);
  if (!m) return { ts: null, author: null };
  const inside = m[1]!;
  const author = m[2]!;
  const candidates = [
    inside.replace(',', ''),
    inside.replace(/,\s+/, ' '),
  ];
  for (const c of candidates) {
    const t = Date.parse(c);
    if (!Number.isNaN(t)) return { ts: new Date(t), author };
  }
  return { ts: null, author };
}

/**
 * Opens a WA chat for the given phone and returns inbound messages currently
 * visible in the conversation pane. Caller filters/dedups by wa_message_id.
 * Does NOT scroll back to load earlier history.
 */
export async function openChatAndReadInbound(
  page: Page,
  phoneE164: string,
): Promise<InboundMessage[]> {
  await page.goto(WA_URL.base, { waitUntil: 'domcontentloaded' });
  if ((await detectLoginState(page)) !== 'logged-in') throw new WaNotLoggedIn();

  const url = WA_URL.send(phoneE164, '');
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  try {
    await page.waitForSelector(SEL.messageInputBox, { timeout: WAIT.conversationReadyMs });
  } catch {
    throw new WaSelectorMismatch('messageInputBox not found when opening chat');
  }

  await page.waitForTimeout(800);

  const rows = await page.$$eval(SEL.messageRow, (rowEls, selectors) => {
    const out: { meta: string | null; text: string; isInbound: boolean; dataId: string | null }[] = [];
    for (const row of rowEls) {
      const isOutbound = row.querySelector(selectors.outboundBubble) !== null;
      const metaEl = row.querySelector(selectors.messageMeta);
      const meta = metaEl ? metaEl.getAttribute('data-pre-plain-text') : null;
      if (!meta) continue;
      const dataIdEl = row.querySelector('[data-id]');
      const dataId = dataIdEl ? dataIdEl.getAttribute('data-id') : null;
      const textEl = row.querySelector(selectors.messageText);
      const text = textEl ? (textEl.textContent ?? '').trim() : '';
      if (!text) continue;
      out.push({ meta, text, isInbound: !isOutbound, dataId });
    }
    return out;
  }, { outboundBubble: SEL.outboundBubble, messageMeta: SEL.messageMeta, messageText: SEL.messageText });

  const MAX_INBOUND = 10;
  const inbound: InboundMessage[] = [];
  for (const r of rows) {
    if (!r.isInbound) continue;
    const { ts } = parsePrePlainText(r.meta ?? '');
    inbound.push({
      wa_message_id: r.dataId,
      wa_sent_at: ts ?? new Date(),
      text: r.text,
    });
  }
  const recent = inbound.slice(-MAX_INBOUND);

  logger.info('wa: read inbound', { phone: phoneE164, visible: inbound.length, kept: recent.length });
  return recent;
}
