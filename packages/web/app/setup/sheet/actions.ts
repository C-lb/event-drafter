'use server';

import { z } from 'zod';
import { getSetting, setSetting } from '@vip/core/settings';
import { parseSheetUrl, previewSheet, getSpreadsheetTitle } from '@vip/worker/google/sheets';

const HISTORY_LIMIT = 8;

const inputSchema = z.object({
  sheet_url: z.string().min(1),
  range: z.string().default('A1:Z'),
});

async function recordHistory(spreadsheet_id: string, sheet_url: string, range: string): Promise<string> {
  let title = '(untitled)';
  try {
    title = await getSpreadsheetTitle(spreadsheet_id);
  } catch {
    // metadata read can fail (auth, rate-limit) — keep going with placeholder
  }
  const prior = getSetting('sheet_history') ?? [];
  const filtered = prior.filter((h) => h.spreadsheet_id !== spreadsheet_id);
  const next = [
    { spreadsheet_id, sheet_url, title, range, last_used: Date.now() },
    ...filtered,
  ].slice(0, HISTORY_LIMIT);
  setSetting('sheet_history', next);
  setSetting('last_sheet_url', sheet_url);
  return title;
}

export async function previewAction(input: unknown) {
  const { sheet_url, range } = inputSchema.parse(input);
  const { spreadsheet_id } = parseSheetUrl(sheet_url);
  const [preview, title] = await Promise.all([
    previewSheet(spreadsheet_id, range, 10),
    recordHistory(spreadsheet_id, sheet_url, range),
  ]);
  return { spreadsheet_id, range, preview, title };
}

const saveSchema = z.object({
  spreadsheet_id: z.string(),
  range: z.string(),
  column_mapping: z.object({
    first_name: z.string(),
    last_name: z.string().optional(),
    phone_e164: z.string(),
    secondary_phone_e164: z.string().optional(),
    email: z.string().optional(),
    remarks: z.string().optional(),
  }),
});

export async function saveSheetBinding(input: unknown) {
  const cfg = saveSchema.parse(input);
  setSetting('contacts_sheet', cfg);
}

export async function getInitialPickerState() {
  return {
    last_sheet_url: getSetting('last_sheet_url') ?? '',
    history: getSetting('sheet_history') ?? [],
  };
}

const deleteHistorySchema = z.object({ spreadsheet_id: z.string() });
export async function deleteHistoryItem(input: unknown) {
  const { spreadsheet_id } = deleteHistorySchema.parse(input);
  const prior = getSetting('sheet_history') ?? [];
  setSetting('sheet_history', prior.filter((h) => h.spreadsheet_id !== spreadsheet_id));
}
