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
  contacts_sheet: 'contacts_sheet',
  style_guide: 'style_guide',
  llm_ready: 'llm_ready',
  setup_completed: 'setup_completed',
  worker_heartbeat: 'worker_heartbeat',
  llm_last_ok: 'llm_last_ok',
  llm_last_error: 'llm_last_error',
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];
