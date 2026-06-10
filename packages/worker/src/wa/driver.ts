import { chromium, type BrowserContext, type Page } from 'playwright';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { SEL, WA_URL, WAIT } from './selectors.js';
import {
  detectLoginState,
  WaInvalidNumber,
  WaNotLoggedIn,
  WaSelectorMismatch,
} from './session.js';
import { logger } from '../logger.js';

const PROFILE_DIR = resolve(process.cwd(), 'data/wa-profile');

// See CONTEXT.md → "UI interaction timing". 300–500 ms between any two
// interactions with WA Web (clicks, fills, navigations). Do not lower.
const HUMAN_PAUSE_MIN_MS = 300;
const HUMAN_PAUSE_MAX_MS = 500;

/** Wait a human-feeling 300–500 ms between WA Web interactions. */
export async function humanPause(page: Page): Promise<void> {
  const ms = HUMAN_PAUSE_MIN_MS + Math.floor(Math.random() * (HUMAN_PAUSE_MAX_MS - HUMAN_PAUSE_MIN_MS + 1));
  await page.waitForTimeout(ms);
}

let _ctx: BrowserContext | null = null;
let _page: Page | null = null;

async function ensureContext(): Promise<{ ctx: BrowserContext; page: Page }> {
  if (_ctx && _page && !_page.isClosed()) return { ctx: _ctx, page: _page };

  mkdirSync(PROFILE_DIR, { recursive: true });
  logger.info('wa: launching persistent context', { profile: PROFILE_DIR });
  _ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1280, height: 820 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  _page = _ctx.pages()[0] ?? (await _ctx.newPage());
  return { ctx: _ctx, page: _page };
}

export async function shutdownWa(): Promise<void> {
  if (_ctx) {
    try { await _ctx.close(); } catch { /* ignore */ }
    _ctx = null;
    _page = null;
  }
}

export async function getLoginState(): Promise<'logged-in' | 'needs-qr' | 'unknown'> {
  const { page } = await ensureContext();
  await page.goto(WA_URL.base, { waitUntil: 'domcontentloaded' });
  return detectLoginState(page);
}

export async function waitForLogin(timeoutMs = 5 * 60 * 1000): Promise<void> {
  const { page } = await ensureContext();
  await page.goto(WA_URL.base, { waitUntil: 'domcontentloaded' });
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await detectLoginState(page, 5_000);
    if (state === 'logged-in') return;
    await page.waitForTimeout(2000);
  }
  throw new WaNotLoggedIn();
}

/**
 * Pre-fills the WA Web input box for the given phone number with the given text.
 * Does NOT click send. The promise resolves when the text is verifiably in the
 * input box (or rejects on selector mismatch / invalid number / not logged in).
 */
export async function prefillDraft(phoneE164: string, text: string): Promise<void> {
  const { page } = await ensureContext();

  await page.goto(WA_URL.base, { waitUntil: 'domcontentloaded' });
  await humanPause(page);
  const loginState = await detectLoginState(page);
  if (loginState !== 'logged-in') throw new WaNotLoggedIn();

  await humanPause(page);
  await page.goto(WA_URL.send(phoneE164, text), { waitUntil: 'domcontentloaded' });
  await humanPause(page);

  const inputLocator = page.locator(SEL.messageInputBox).first();
  const invalidLocator = page.locator(SEL.invalidNumberDialog).first();

  const winner = await Promise.race([
    inputLocator.waitFor({ state: 'visible', timeout: WAIT.inputReadyMs }).then(() => 'input' as const),
    invalidLocator.waitFor({ state: 'visible', timeout: WAIT.inputReadyMs }).then(() => 'invalid' as const),
  ]).catch(() => 'timeout' as const);

  if (winner === 'invalid') throw new WaInvalidNumber(phoneE164);
  if (winner === 'timeout') throw new WaSelectorMismatch('messageInputBox or invalidNumberDialog');

  const deadline = Date.now() + WAIT.inputFilledMs;
  while (Date.now() < deadline) {
    const got = (await inputLocator.innerText().catch(() => '')) || '';
    const needle = text.replace(/\s+/g, '').slice(0, 20);
    const haystack = got.replace(/\s+/g, '');
    if (needle && haystack.includes(needle)) {
      logger.info('wa: prefill verified', { phone: phoneE164, bytes: text.length });
      return;
    }
    await page.waitForTimeout(500);
  }
  throw new WaSelectorMismatch('input box did not receive prefilled text');
}

import { openChatAndReadInbound as _read } from './reader.js';

export async function readChatInbound(phoneE164: string) {
  const { page } = await ensureContext();
  return _read(page, phoneE164);
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    void shutdownWa().finally(() => process.exit(0));
  });
}
