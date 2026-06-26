import { google } from 'googleapis';
import type { OAuth2Client, Credentials } from 'google-auth-library';
import { getSetting, setSetting } from '@event-drafter/core/settings';

export const SCOPES = [
  // Read-write: the delegate tracker shifts confirmed rows in the operator's
  // sheet, so a read-only scope is no longer enough. Existing tokens minted
  // under spreadsheets.readonly must be re-authorized (visit /setup/google).
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/gmail.readonly',
];

export class GoogleOAuthNotConfigured extends Error {
  constructor() {
    super('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI missing from .env');
  }
}

export class GoogleNotAuthorized extends Error {
  constructor() {
    super('Google not yet authorized — visit /setup/google');
  }
}

function envOrThrow(): { id: string; secret: string; redirect: string } {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  const redirect = process.env.GOOGLE_REDIRECT_URI;
  if (!id || !secret || !redirect) throw new GoogleOAuthNotConfigured();
  return { id, secret, redirect };
}

export function buildClient(): OAuth2Client {
  const { id, secret, redirect } = envOrThrow();
  return new google.auth.OAuth2(id, secret, redirect);
}

export function buildAuthUrl(state: string): string {
  const client = buildClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state,
  });
}

export async function exchangeCode(code: string): Promise<void> {
  const client = buildClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error('No refresh_token in response — revoke app access in Google Account and retry');
  }
  persistTokens(tokens);
}

export function persistTokens(t: Credentials): void {
  if (!t.access_token || !t.refresh_token || !t.expiry_date) {
    throw new Error('incomplete tokens');
  }
  setSetting('google_tokens', {
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expiry_date: t.expiry_date,
    scope: t.scope ?? SCOPES.join(' '),
  });
}

export function authorizedClient(): OAuth2Client {
  const stored = getSetting('google_tokens');
  if (!stored) throw new GoogleNotAuthorized();
  const client = buildClient();
  client.setCredentials(stored);
  client.on('tokens', (t) => {
    persistTokens({ ...stored, ...t });
  });
  return client;
}
