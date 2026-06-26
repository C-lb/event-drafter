import { google } from 'googleapis';
import { authorizedClient } from './oauth.js';
import { createHash } from 'node:crypto';
import type { ContactsSheet } from '@event-drafter/core/settings';

export interface SheetRow {
  first_name: string;
  last_name: string | null;
  phone_e164: string;
  secondary_phone_e164: string | null;
  email: string | null;
  remarks: string | null;
  sheet_row_hash: string;
  /** 1-based row number in the source sheet (matches the Google Sheets row gutter). */
  sheet_row_index: number;
}

/**
 * The 1-based starting row of a sheet range. `A1:Z` -> 1, `Sheet1!A5:G` -> 5,
 * `A:Z` (no row) -> 1. Lets us report the real gutter row even when the
 * configured range doesn't start at the top.
 */
export function rangeStartRow(range: string): number {
  const cell = range.includes('!') ? range.slice(range.indexOf('!') + 1) : range;
  const m = cell.match(/[A-Za-z]+(\d+)/);
  return m ? parseInt(m[1]!, 10) : 1;
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
  maxRows = 10,
): Promise<SheetPreview> {
  const { data } = await sheets().spreadsheets.values.get({ spreadsheetId: spreadsheet_id, range });
  const all = data.values ?? [];
  const headers = (all[0] ?? []).map((h) => String(h));
  const rows = all.slice(1, 1 + maxRows).map((r) => r.map((c) => String(c ?? '')));
  return { headers, rows };
}

export async function getSpreadsheetTitle(spreadsheet_id: string): Promise<string> {
  const { data } = await sheets().spreadsheets.get({
    spreadsheetId: spreadsheet_id,
    fields: 'properties.title',
  });
  return data.properties?.title ?? '(untitled)';
}

/**
 * Normalize a phone number to its last 8 digits (Singapore mobile length) so a
 * sheet value like "+65 9123 4567" matches a stored "+6591234567".
 */
export function phoneKey(raw: string | null | undefined): string {
  const digits = String(raw ?? '').replace(/\D/g, '');
  return digits.slice(-8);
}

export interface DelegateReorderPlan {
  /** Full grid (header + rows) in the new order, ready to write back. */
  values: string[][];
  /** How many rows were moved into the confirmed block. */
  confirmed: number;
  changed: boolean;
}

/**
 * Pure reorder: given the sheet's full values (row 0 = headers) and the set of
 * confirmed phone keys, move every matching row into a contiguous confirmed
 * block at the top (stable within each group), renumber the "No" column 1..N,
 * and return the new grid. No I/O — unit-testable.
 *
 * Returns changed=false when there is no "Mobile No." column or the order and
 * numbering already match (so the caller can skip the write).
 */
export function planDelegateReorder(
  values: string[][],
  confirmedKeys: Set<string>,
): DelegateReorderPlan {
  if (values.length < 2) return { values, confirmed: 0, changed: false };
  const headers = values[0]!.map((h) => String(h ?? '').trim());
  const mobileCol = headers.findIndex((h) => /mobile/i.test(h));
  const noCol = headers.findIndex((h) => h.toLowerCase() === 'no' || h.toLowerCase() === 'no.');
  if (mobileCol === -1) return { values, confirmed: 0, changed: false };

  const dataRows = values.slice(1);
  const confirmed: string[][] = [];
  const pending: string[][] = [];
  for (const row of dataRows) {
    if (confirmedKeys.has(phoneKey(row[mobileCol]))) confirmed.push(row);
    else pending.push(row);
  }
  const ordered = [...confirmed, ...pending];

  // Renumber the "No" column to match the new top-to-bottom order.
  if (noCol !== -1) {
    ordered.forEach((row, i) => {
      while (row.length <= noCol) row.push('');
      row[noCol] = String(i + 1);
    });
  }

  const newValues = [values[0]!, ...ordered];
  const changed = JSON.stringify(newValues) !== JSON.stringify(values);
  return { values: newValues, confirmed: confirmed.length, changed };
}

/**
 * Shift the rows of confirmed delegates to the top of their tracker sheet.
 * Reads the first tab, reorders via planDelegateReorder, and writes the grid
 * back (values only — cell formatting stays with its position). Idempotent.
 */
export async function shiftConfirmedToTop(
  spreadsheet_id: string,
  confirmedKeys: Set<string>,
): Promise<{ confirmed: number; changed: boolean }> {
  const api = sheets();
  const meta = await api.spreadsheets.get({
    spreadsheetId: spreadsheet_id,
    fields: 'sheets.properties.title',
  });
  const title = meta.data.sheets?.[0]?.properties?.title;
  if (!title) throw new Error('tracker sheet has no tabs');

  const { data } = await api.spreadsheets.values.get({ spreadsheetId: spreadsheet_id, range: title });
  const values = (data.values ?? []).map((r) => r.map((c) => String(c ?? '')));
  const plan = planDelegateReorder(values, confirmedKeys);
  if (!plan.changed) return { confirmed: plan.confirmed, changed: false };

  await api.spreadsheets.values.update({
    spreadsheetId: spreadsheet_id,
    range: `${title}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: plan.values },
  });
  return { confirmed: plan.confirmed, changed: true };
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

  // Header sits on the first row of the range; data starts one row below it.
  // Preserve each contact's real gutter row so order and serial numbers
  // mirror the sheet, skipping blank/incomplete rows along the way.
  const dataStartRow = rangeStartRow(cfg.range) + 1;

  const out: SheetRow[] = [];
  all.slice(1).forEach((raw, i) => {
    const sheet_row_index = dataStartRow + i;
    const get = (j: number): string | null => (j >= 0 ? String(raw[j] ?? '').trim() || null : null);
    const first_name = get(idx.first_name);
    const phone_e164 = get(idx.phone_e164);
    if (!first_name || !phone_e164) return;

    const fields = {
      first_name,
      last_name: get(idx.last_name),
      phone_e164,
      secondary_phone_e164: get(idx.secondary_phone_e164),
      email: get(idx.email),
      remarks: get(idx.remarks),
    };
    const hash = createHash('sha256').update(JSON.stringify(fields)).digest('hex');
    out.push({ ...fields, sheet_row_hash: hash, sheet_row_index });
  });
  return out;
}
