import { google } from 'googleapis';
import { authorizedClient } from './oauth.js';
import { createHash } from 'node:crypto';
import type { ContactsSheet } from '@vip/core/settings';

export interface SheetRow {
  first_name: string;
  last_name: string | null;
  phone_e164: string;
  secondary_phone_e164: string | null;
  email: string | null;
  remarks: string | null;
  sheet_row_hash: string;
}

export interface SheetPreview {
  headers: string[];
  rows: string[][];
}

function sheets() {
  return google.sheets({ version: 'v4', auth: authorizedClient() });
}

export function parseSheetUrl(url: string): { spreadsheet_id: string } {
  const m = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return { spreadsheet_id: m[1]! };
  if (/^[a-zA-Z0-9-_]{20,}$/.test(url.trim())) return { spreadsheet_id: url.trim() };
  throw new Error('Could not extract spreadsheet ID from input');
}

export async function previewSheet(
  spreadsheet_id: string,
  range: string,
  maxRows = 5,
): Promise<SheetPreview> {
  const { data } = await sheets().spreadsheets.values.get({ spreadsheetId: spreadsheet_id, range });
  const all = data.values ?? [];
  const headers = (all[0] ?? []).map((h) => String(h));
  const rows = all.slice(1, 1 + maxRows).map((r) => r.map((c) => String(c ?? '')));
  return { headers, rows };
}

export async function fetchAllRows(cfg: ContactsSheet): Promise<SheetRow[]> {
  const { data } = await sheets().spreadsheets.values.get({
    spreadsheetId: cfg.spreadsheet_id,
    range: cfg.range,
  });
  const all = data.values ?? [];
  if (all.length === 0) return [];
  const headers = (all[0] ?? []).map((h) => String(h));
  const headerIdx = (name: string): number => headers.indexOf(name);
  const idx = {
    first_name: headerIdx(cfg.column_mapping.first_name),
    last_name: cfg.column_mapping.last_name ? headerIdx(cfg.column_mapping.last_name) : -1,
    phone_e164: headerIdx(cfg.column_mapping.phone_e164),
    secondary_phone_e164: cfg.column_mapping.secondary_phone_e164 ? headerIdx(cfg.column_mapping.secondary_phone_e164) : -1,
    email: cfg.column_mapping.email ? headerIdx(cfg.column_mapping.email) : -1,
    remarks: cfg.column_mapping.remarks ? headerIdx(cfg.column_mapping.remarks) : -1,
  };

  if (idx.first_name === -1) throw new Error(`Mapped column not found: ${cfg.column_mapping.first_name}`);
  if (idx.phone_e164 === -1) throw new Error(`Mapped column not found: ${cfg.column_mapping.phone_e164}`);

  const out: SheetRow[] = [];
  for (const raw of all.slice(1)) {
    const get = (i: number): string | null => (i >= 0 ? String(raw[i] ?? '').trim() || null : null);
    const first_name = get(idx.first_name);
    const phone_e164 = get(idx.phone_e164);
    if (!first_name || !phone_e164) continue;

    const fields = {
      first_name,
      last_name: get(idx.last_name),
      phone_e164,
      secondary_phone_e164: get(idx.secondary_phone_e164),
      email: get(idx.email),
      remarks: get(idx.remarks),
    };
    const hash = createHash('sha256').update(JSON.stringify(fields)).digest('hex');
    out.push({ ...fields, sheet_row_hash: hash });
  }
  return out;
}
