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
    full_name: string;
    preferred_name?: string;
    phone_e164: string;
    email?: string;
    personal_note?: string;
    interests?: string;
  };
}

interface SettingTypes {
  google_tokens: GoogleTokens;
  google_client_id: string;
  contacts_sheet: ContactsSheet;
  style_guide: string;
  anthropic_key_set: boolean;
  setup_completed: boolean;
  worker_heartbeat: { ts: number; node: string };
  anthropic_last_ok: { ts: number };
  anthropic_last_error: { ts: number; message: string };
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
