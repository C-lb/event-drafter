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
  google_client_secret: string;
  google_redirect_uri: string;
  anthropic_api_key: string;
  llm_provider: 'ollama' | 'anthropic';
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
  rate_limit_config: Partial<{ minGapMs: number; maxGapMs: number; batchLimit: number; cooldownMinMs: number; cooldownMaxMs: number; maxSendsPerHour: number }>;
  timing_config: Partial<TimingConfig>;
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

// ---------------------------------------------------------------------------
// Timing config: operator-tunable schedule knobs, read live (no worker restart).
//   - follow_up_delay_days: how long after an invite is sent, with no reply,
//     before a follow-up is drafted.
//   - reply_lookback_days: how far back a reply scan looks at sent invites.
//   - reply_check_times: daily wall-clock times (Asia/Singapore) the worker
//     scans WhatsApp for replies. 24h "HH:MM".
// ---------------------------------------------------------------------------

export interface TimingConfig {
  follow_up_delay_days: number;
  reply_lookback_days: number;
  reply_check_times: string[];
}

export const TIMING_DEFAULTS: TimingConfig = {
  follow_up_delay_days: 3,
  reply_lookback_days: 14,
  reply_check_times: ['12:00', '18:00'],
};

/** Reply-check timezone. Times are entered and displayed in this zone. */
export const TIMING_TZ = 'Asia/Singapore';

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** True if `s` is a valid 24h "HH:MM" string. */
export function isValidTime(s: string): boolean {
  return TIME_RE.test(s);
}

/** Settings override merged over defaults; invalid fields fall back to default.
 *  Read per call so a saved change applies on the next scheduler tick / job. */
export function getTimingConfig(): TimingConfig {
  const o = (getSetting('timing_config') ?? {}) as Partial<TimingConfig>;
  const posInt = (v: unknown, d: number) =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : d;

  let times = Array.isArray(o.reply_check_times)
    ? o.reply_check_times.filter((t): t is string => typeof t === 'string' && isValidTime(t))
    : [];
  // De-dupe and sort ascending; fall back to defaults if nothing valid remains.
  times = [...new Set(times)].sort();
  if (times.length === 0) times = [...TIMING_DEFAULTS.reply_check_times];

  return {
    follow_up_delay_days: posInt(o.follow_up_delay_days, TIMING_DEFAULTS.follow_up_delay_days),
    reply_lookback_days: posInt(o.reply_lookback_days, TIMING_DEFAULTS.reply_lookback_days),
    reply_check_times: times,
  };
}
