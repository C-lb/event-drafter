import { google, type gmail_v1 } from 'googleapis';
import { authorizedClient } from './oauth.js';

export interface GmailMessageSummary {
  id: string;
  thread_id: string;
  from: string;
  subject: string;
  snippet: string;
  internal_date: number;
}

export interface GmailMessageFull extends GmailMessageSummary {
  body_text: string;
}

function gmail() {
  return google.gmail({ version: 'v1', auth: authorizedClient() });
}

export async function listRecentMessages(query: string, max = 20): Promise<GmailMessageSummary[]> {
  const g = gmail();
  const list = await g.users.messages.list({
    userId: 'me',
    q: query,
    maxResults: max,
  });
  const ids = list.data.messages ?? [];
  const out: GmailMessageSummary[] = [];
  for (const m of ids) {
    if (!m.id) continue;
    const full = await g.users.messages.get({
      userId: 'me',
      id: m.id,
      format: 'metadata',
      metadataHeaders: ['From', 'Subject'],
    });
    const h = full.data.payload?.headers ?? [];
    out.push({
      id: m.id,
      thread_id: full.data.threadId ?? '',
      from: h.find((x) => x.name === 'From')?.value ?? '',
      subject: h.find((x) => x.name === 'Subject')?.value ?? '',
      snippet: full.data.snippet ?? '',
      internal_date: Number(full.data.internalDate ?? 0),
    });
  }
  return out;
}

function decodeBody(data: string): string {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
}

type GmailPart = gmail_v1.Schema$MessagePart;
type GmailPayload = GmailPart | undefined;

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

/**
 * Crude HTML → text. Preserves line breaks from block-level tags so downstream
 * heuristics (Date:, Venue:, Time:) keep their line anchors. Not a full parser
 * — Gmail invite bodies are simple enough for this.
 */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<head[\s\S]*?<\/head>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      // Opening <li> injects its own line + bullet; closing </li> must NOT
      // add a second newline (would produce a blank line between list items).
      .replace(/<li[^>]*>/gi, '\n• ')
      .replace(/<\/(p|div|tr|h[1-6]|article|section|header|footer|blockquote|pre)>/gi, '\n')
      .replace(/<\/li>/gi, '')
      .replace(/<[^>]+>/g, ''),
  )
    // Collapse runs of spaces/tabs but PRESERVE newlines so the labelled
    // lines (Date:, Time:, Venue:, Address:, Dress Code:) survive.
    .replace(/[ \t ]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Depth-first search for the first part matching `pred`. */
function findPart(p: GmailPart, pred: (p: GmailPart) => boolean): GmailPart | null {
  if (pred(p)) return p;
  for (const child of p.parts ?? []) {
    const found = findPart(child, pred);
    if (found) return found;
  }
  return null;
}

export function extractText(payload: GmailPayload): string {
  if (!payload) return '';

  const isMime = (p: GmailPart, mt: string) => (p.mimeType ?? '').toLowerCase().startsWith(mt);
  const hasData = (p: GmailPart) => Boolean(p.body?.data);

  // Prefer text/plain anywhere in the tree.
  const plain = findPart(payload, (p) => isMime(p, 'text/plain') && hasData(p));
  if (plain?.body?.data) return decodeBody(plain.body.data);

  // Fall back to text/html anywhere in the tree.
  const html = findPart(payload, (p) => isMime(p, 'text/html') && hasData(p));
  if (html?.body?.data) return htmlToText(decodeBody(html.body.data));

  return '';
}

export async function fetchMessage(id: string): Promise<GmailMessageFull> {
  const full = await gmail().users.messages.get({ userId: 'me', id, format: 'full' });
  const h = full.data.payload?.headers ?? [];
  return {
    id,
    thread_id: full.data.threadId ?? '',
    from: h.find((x) => x.name === 'From')?.value ?? '',
    subject: h.find((x) => x.name === 'Subject')?.value ?? '',
    snippet: full.data.snippet ?? '',
    internal_date: Number(full.data.internalDate ?? 0),
    body_text: extractText(full.data.payload),
  };
}
