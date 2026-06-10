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

type GmailPayload = gmail_v1.Schema$MessagePart | undefined;

function extractText(payload: GmailPayload): string {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return decodeBody(payload.body.data);
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return decodeBody(part.body.data);
      }
    }
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        const html = decodeBody(part.body.data);
        return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      }
    }
  }
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
