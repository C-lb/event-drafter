'use server';

import { z } from 'zod';
import { getTimingConfig, setSetting, isValidTime, type TimingConfig } from '@event-drafter/core/settings';

export async function getTiming(): Promise<TimingConfig> {
  return getTimingConfig();
}

const schema = z.object({
  follow_up_delay_days: z.number().int().min(1).max(90),
  reply_lookback_days: z.number().int().min(1).max(90),
  reply_check_times: z
    .array(z.string().refine(isValidTime, 'times must be HH:MM'))
    .min(1, 'add at least one reply-check time')
    .max(12, 'too many times'),
});

export async function saveTiming(
  input: unknown,
): Promise<{ ok: true; config: TimingConfig } | { ok: false; error: string }> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid input' };
  }
  // De-dupe + sort so storage matches how the scheduler reads it.
  const times = [...new Set(parsed.data.reply_check_times)].sort();
  setSetting('timing_config', {
    follow_up_delay_days: parsed.data.follow_up_delay_days,
    reply_lookback_days: parsed.data.reply_lookback_days,
    reply_check_times: times,
  });
  return { ok: true, config: getTimingConfig() };
}
