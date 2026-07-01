import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull().$type<unknown>(),
  updated_at: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export type Setting = typeof settings.$inferSelect;
export type NewSetting = typeof settings.$inferInsert;

/** Known setting keys — keep typed for safe access. */
export const SETTING_KEYS = {
  google_tokens: 'google_tokens',
  google_client_id: 'google_client_id',
  google_client_secret: 'google_client_secret',
  google_redirect_uri: 'google_redirect_uri',
  contacts_sheet: 'contacts_sheet',
  style_guide: 'style_guide',
  llm_ready: 'llm_ready',
  llm_provider: 'llm_provider',
  anthropic_api_key: 'anthropic_api_key',
  wa_ready: 'wa_ready',
  operator_persona_name: 'operator_persona_name',
  operator_persona_role: 'operator_persona_role',
  auto_send_enabled: 'auto_send_enabled',
  setup_completed: 'setup_completed',
  worker_heartbeat: 'worker_heartbeat',
  worker_restart_requested: 'worker_restart_requested',
  llm_last_ok: 'llm_last_ok',
  llm_last_error: 'llm_last_error',
  sheet_history: 'sheet_history',
  last_sheet_url: 'last_sheet_url',
  worker_safety_stop: 'worker_safety_stop',
  rate_limit_config: 'rate_limit_config',
  timing_config: 'timing_config',
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];
