import { chromium, type BrowserContext, type Page } from 'playwright';
import { resolve, join } from 'node:path';
import { mkdirSync, unlinkSync, lstatSync, readlinkSync } from 'node:fs';
import { SEL, WA_URL, WAIT } from './selectors.js';
import {
  detectLoginState,
  WaInvalidNumber,
  WaNotLoggedIn,
  WaSelectorMismatch,
  WaSendNotConfirmed,
} from './session.js';
import {
  evaluateSendState,
  statusTextIsPending,
  type SendObservation,
  type SendState,
} from './send-verify.js';
import { logger } from '../logger.js';

// Stable absolute path so the web (Next.js) and worker (tsx) processes share
// one WA session — otherwise their different cwds give them different profiles
// and scanning the QR in /setup/wa would not log the worker in.
const PROFILE_DIR = process.env.ED_WA_PROFILE_DIR ?? resolve(process.cwd(), 'data/wa-profile');

export class WaProfileLocked extends Error {
  constructor(public profileDir: string) {
    super(
      `WhatsApp profile at ${profileDir} is already in use by another Chromium. ` +
        `Quit any open "Chrome for Testing" windows and try again.`,
    );
    this.name = 'WaProfileLocked';
  }
}

/**
 * Chromium leaves SingletonLock / SingletonSocket / SingletonCookie symlinks
 * pointing at the owning pid. If the pid is gone (e.g., previous run crashed,
 * or Next.js HMR threw away our module-level _ctx reference), the lock is
 * stale and `launchPersistentContext` will fail with an unhelpful error.
 * Clear stale ones only — never touch live ones.
 */
function clearStaleProfileLocks(dir: string): void {
  for (const name of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    const lockPath = join(dir, name);
    let isSymlink = false;
    try {
      isSymlink = lstatSync(lockPath).isSymbolicLink();
    } catch {
      continue; // file does not exist
    }
    if (isSymlink) {
      // Symlink target on macOS is `<hostname>-<pid>` — if the pid is alive,
      // the lock is real and we leave it. Otherwise it is stale.
      try {
        const target = readlinkSync(lockPath);
        const pid = Number(target.split('-').pop());
        if (Number.isFinite(pid) && pid > 0) {
          try {
            process.kill(pid, 0);
            continue; // alive — keep the lock
          } catch {
            // ESRCH — pid is gone, fall through and delete
          }
        }
      } catch {
        // unreadable symlink, treat as stale
      }
    }
    try {
      unlinkSync(lockPath);
      logger.info('wa: cleared stale profile lock', { lockPath });
    } catch {
      /* ignore */
    }
  }
}

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
  clearStaleProfileLocks(PROFILE_DIR);
  logger.info('wa: launching persistent context', { profile: PROFILE_DIR });
  try {
    _ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: false,
      viewport: { width: 1280, height: 820 },
      args: ['--disable-blink-features=AutomationControlled'],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/ProcessSingleton|profile is already in use|SingletonLock/i.test(msg)) {
      throw new WaProfileLocked(PROFILE_DIR);
    }
    throw err;
  }
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

  // Single navigation: the /send deep-link loads the app AND opens the chat
  // (pre-filling the composer from the &text= param). We deliberately do NOT
  // first goto(base) + detectLoginState — that's a second full reload, and each
  // reload re-enters WA Web's multi-minute "downloading messages" splash, which
  // is what was causing every send to time out and defer. Instead we infer
  // state from whichever element wins the race below:
  //   composer visible  → logged in AND ready
  //   QR canvas visible → genuinely logged out (needs re-scan)
  //   invalid dialog    → number not on WhatsApp
  //   none within appReadyMs → still loading / layout drift
  await page.goto(WA_URL.send(phoneE164, text), { waitUntil: 'domcontentloaded' });
  await humanPause(page);

  const inputLocator = page.locator(SEL.messageInputBox).first();
  const qrLocator = page.locator(SEL.qrCanvas).first();
  const invalidLocator = page
    .getByText(/phone number shared via url is invalid|invalid phone number/i)
    .first();

  const winner = await Promise.race([
    inputLocator.waitFor({ state: 'visible', timeout: WAIT.appReadyMs }).then(() => 'input' as const),
    qrLocator.waitFor({ state: 'visible', timeout: WAIT.appReadyMs }).then(() => 'qr' as const),
    invalidLocator.waitFor({ state: 'visible', timeout: WAIT.appReadyMs }).then(() => 'invalid' as const),
  ]).catch(() => 'timeout' as const);

  if (winner === 'qr') throw new WaNotLoggedIn();
  if (winner === 'invalid') throw new WaInvalidNumber(phoneE164);
  if (winner === 'timeout') throw new WaSelectorMismatch('messageInputBox/qrCanvas/invalidNumber within appReadyMs');

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

import {
  openChatAndReadInbound as _read,
  scrapeOutboundReactions as _readReactions,
  type ReadOpts,
} from './reader.js';

export async function readChatInbound(
  phoneE164: string,
  contactDisplayName?: string,
  opts: ReadOpts = {},
) {
  const { page } = await ensureContext();
  return _read(page, phoneE164, contactDisplayName, opts);
}

/**
 * Reads reactions on the CURRENTLY-OPEN chat. Intended to be called right after
 * `readChatInbound(phone, ...)` for the same contact — that call leaves the page
 * on the contact's chat, so this scrapes it without an extra navigation.
 */
export async function readChatReactions(): Promise<string[]> {
  const { page } = await ensureContext();
  return _readReactions(page);
}

/**
 * One-shot login check + WA.base navigation. Call once at the start of any
 * batch read loop (e.g. check_replies) and pass `skipPrelude: true` to the
 * subsequent `readChatInbound` calls. Throws `WaNotLoggedIn` so callers can
 * defer the whole job.
 */
export async function ensureWaLoggedIn(): Promise<void> {
  const { page } = await ensureContext();
  await page.goto(WA_URL.base, { waitUntil: 'domcontentloaded' });
  const state = await detectLoginState(page);
  if (state !== 'logged-in') {
    throw new WaNotLoggedIn();
  }
}

/**
 * Auto-send mode: clicks the WA Web send button in the currently-focused chat
 * (which `prefillDraft` left ready). The caller MUST have just prefilled this
 * very chat; we don't re-verify the target number here — clicking send blindly
 * in the wrong chat would deliver the wrong message.
 *
 * NOTE: This overrides the prior "human always clicks send" constraint in
 * CONTEXT.md. The rate limiter (≥2:59 between sends, batches of 5-8,
 * cool-down 15-30 min) still applies, but auto-send removes one of the
 * human-fingerprint signals WA looks for. Toggle off via auto_send_enabled
 * if WA Web starts challenging the account.
 */
export async function clickSendInPrefilledChat(draftText: string): Promise<void> {
  const { page } = await ensureContext();
  await humanPause(page);
  const sendBtn = page.locator(SEL.sendButton).first();
  try {
    await sendBtn.waitFor({ state: 'visible', timeout: WAIT.inputReadyMs });
  } catch {
    throw new WaSelectorMismatch('sendButton');
  }
  await humanPause(page);
  await sendBtn.click();
  logger.info('wa: send button clicked — verifying delivery');

  // Don't trust the click: poll until the draft shows up as the newest
  // outbound bubble with no pending clock. Marking an invite `sent` on an
  // unconfirmed click is how messages silently go missing (e.g. the browser
  // shuts down while WA still has the message queued).
  let state: SendState = 'pending';
  const deadline = Date.now() + WAIT.sendVerifyMs;
  while (Date.now() < deadline) {
    state = evaluateSendState(await observeSendState(page), draftText);
    if (state === 'confirmed') {
      logger.info('wa: send confirmed', { bytes: draftText.length });
      return;
    }
    await page.waitForTimeout(500);
  }
  throw new WaSendNotConfirmed(state);
}

async function observeSendState(page: Page): Promise<SendObservation> {
  const composeText =
    (await page.locator(SEL.messageInputBox).first().innerText().catch(() => '')) || '';
  const lastBubble = page.locator(SEL.outboundBubble).last();
  const lastOutboundText = await lastBubble.innerText().catch(() => null);
  let lastOutboundPending = false;
  if (lastOutboundText !== null) {
    // WA 2026-06: delivery state is an aria-label ("Pending"/"Sent"/"Delivered"/
    // "Read", often space-padded e.g. " Delivered ") on a status node inside the
    // bubble. Collect the bubble's aria-labels and pick the status one. If none
    // is present (older WA build), fall back to the legacy pending clock.
    const statusLabel = await lastBubble
      .evaluate((el) => {
        const labels = Array.from(el.querySelectorAll('[aria-label]')).map(
          (n) => (n.getAttribute('aria-label') || '').trim(),
        );
        return labels.find((l) => /^(pending|sending|sent|delivered|read)$/i.test(l)) ?? null;
      })
      .catch(() => null);
    if (statusLabel !== null) {
      lastOutboundPending = statusTextIsPending(statusLabel);
    } else {
      lastOutboundPending =
        (await lastBubble.locator(SEL.pendingClock).count().catch(() => 0)) > 0;
    }
  }
  return { composeText, lastOutboundText, lastOutboundPending };
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    void shutdownWa().finally(() => process.exit(0));
  });
}
