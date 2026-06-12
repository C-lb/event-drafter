import type { Page } from 'playwright';
import { SEL, WAIT } from './selectors.js';

export type LoginState = 'logged-in' | 'needs-qr' | 'unknown';

export async function detectLoginState(page: Page, timeoutMs = WAIT.appReadyMs): Promise<LoginState> {
  try {
    await page.waitForSelector(`${SEL.chatListPane}, ${SEL.qrCanvas}`, { timeout: timeoutMs });
  } catch {
    return 'unknown';
  }
  if (await page.$(SEL.chatListPane)) return 'logged-in';
  if (await page.$(SEL.qrCanvas)) return 'needs-qr';
  return 'unknown';
}

export class WaNotLoggedIn extends Error {
  constructor() {
    super('WhatsApp Web is not logged in — scan QR via /setup/wa');
    this.name = 'WaNotLoggedIn';
  }
}

export class WaSelectorMismatch extends Error {
  constructor(public selectorName: string) {
    super(`WA selector "${selectorName}" did not match — WA layout may have changed. See packages/worker/src/wa/selectors.ts`);
    this.name = 'WaSelectorMismatch';
  }
}

export class WaInvalidNumber extends Error {
  constructor(public phone: string) {
    super(`WhatsApp says this number is invalid: ${phone}`);
    this.name = 'WaInvalidNumber';
  }
}

export class WaSendNotConfirmed extends Error {
  constructor(public lastState: 'pending' | 'not-sent') {
    super(
      `Clicked WA send but could not confirm delivery (last observed: ${lastState}). ` +
      'Not marking as sent — check the chat manually or resend.',
    );
    this.name = 'WaSendNotConfirmed';
  }
}
