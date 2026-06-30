import { getDb } from './db.js';
import { settings, SETTING_KEYS, type SettingKey } from './schema/settings.js';
import { eq } from 'drizzle-orm';

export interface GoogleTokens {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
  scope: string;
}

export interface ContactsSheet {
  spreadsheet_id: string;
  range: string;
  column_mapping: {
    first_name: string;
    last_name?: string;
    phone_e164: string;
    secondary_phone_e164?: string;
    email?: string;
    remarks?: string;
  };
}

interface SettingTypes {
  google_tokens: GoogleTokens;
  google_client_id: string;
  contacts_sheet: ContactsSheet;
  style_guide: string;
  llm_ready: boolean;
  wa_ready: boolean;
  operator_persona_name: string;
  operator_persona_role: string;
  auto_send_enabled: boolean;
  setup_completed: boolean;
  worker_heartbeat: { ts: number; node: string; startedAt?: number; pid?: number };
  worker_restart_requested: { ts: number };
  llm_last_ok: { ts: number };
  llm_last_error: { ts: number; message: string };
  sheet_history: Array<{
    spreadsheet_id: string;
    sheet_url: string;
    title: string;
    range: string;
    last_used: number;
  }>;
  last_sheet_url: string;
  worker_safety_stop: { engaged: boolean; ts: number };
}

export function getSetting<K extends SettingKey>(key: K): SettingTypes[K] | null {
  const db = getDb();
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  return (row?.value as SettingTypes[K] | undefined) ?? null;
}

export function setSetting<K extends SettingKey>(key: K, value: SettingTypes[K]): void {
  const db = getDb();
  db.insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updated_at: new Date() },
    })
    .run();
}

export function deleteSetting(key: SettingKey): void {
  const db = getDb();
  db.delete(settings).where(eq(settings.key, key)).run();
}

export { SETTING_KEYS };
