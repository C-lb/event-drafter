'use server';

import { z } from 'zod';
import { setSetting } from '@vip/core/settings';
import { parseSheetUrl, previewSheet } from '@vip/worker/google/sheets';

const inputSchema = z.object({
  sheet_url: z.string().min(1),
  range: z.string().default('Contacts!A1:F'),
});

export async function previewAction(input: unknown) {
  const { sheet_url, range } = inputSchema.parse(input);
  const { spreadsheet_id } = parseSheetUrl(sheet_url);
  const preview = await previewSheet(spreadsheet_id, range);
  return { spreadsheet_id, range, preview };
}

const saveSchema = z.object({
  spreadsheet_id: z.string(),
  range: z.string(),
  column_mapping: z.object({
    full_name: z.string(),
    preferred_name: z.string().optional(),
    phone_e164: z.string(),
    email: z.string().optional(),
    personal_note: z.string().optional(),
    interests: z.string().optional(),
  }),
});

export async function saveSheetBinding(input: unknown) {
  const cfg = saveSchema.parse(input);
  setSetting('contacts_sheet', cfg);
}
