/** Human-scale form values (gaps in seconds, cooldowns in minutes, counts as-is). */
export interface RateLimitForm {
  minGapSec: number;
  maxGapSec: number;
  batchLimit: number;
  cooldownMinMin: number;
  cooldownMaxMin: number;
  maxSendsPerHour: number;
}

/** Wire values in ms/counts (what the worker and DB store). */
export interface RateLimitMs {
  minGapMs: number;
  maxGapMs: number;
  batchLimit: number;
  cooldownMinMs: number;
  cooldownMaxMs: number;
  maxSendsPerHour: number;
}

/** Mirrors RATE_LIMIT_DEFAULTS in the worker: keep in sync if either changes. */
export const FORM_DEFAULTS: RateLimitForm = {
  minGapSec: 10,
  maxGapSec: 15,
  batchLimit: 8,
  cooldownMinMin: 15,
  cooldownMaxMin: 30,
  maxSendsPerHour: 18,
};

export function toMs(f: RateLimitForm): RateLimitMs {
  return {
    minGapMs: Math.round(f.minGapSec * 1000),
    maxGapMs: Math.round(f.maxGapSec * 1000),
    batchLimit: Math.round(f.batchLimit),
    cooldownMinMs: Math.round(f.cooldownMinMin * 60_000),
    cooldownMaxMs: Math.round(f.cooldownMaxMin * 60_000),
    maxSendsPerHour: Math.round(f.maxSendsPerHour),
  };
}

export function fromMs(m: RateLimitMs): RateLimitForm {
  return {
    minGapSec: m.minGapMs / 1000,
    maxGapSec: m.maxGapMs / 1000,
    batchLimit: m.batchLimit,
    cooldownMinMin: m.cooldownMinMs / 60_000,
    cooldownMaxMin: m.cooldownMaxMs / 60_000,
    maxSendsPerHour: m.maxSendsPerHour,
  };
}

/** Per-field warning string when the value is more aggressive than recommended-safe, else absent. */
export function warnings(f: RateLimitForm): Partial<Record<keyof RateLimitForm, string>> {
  const w: Partial<Record<keyof RateLimitForm, string>> = {};
  if (f.minGapSec < 10) w.minGapSec = 'Below 10s recommended, raises ban risk';
  if (f.maxSendsPerHour > 18) w.maxSendsPerHour = 'Above 18 per hour recommended, raises ban risk';
  if (f.cooldownMinMin < 15) w.cooldownMinMin = 'Below 15 min recommended, raises ban risk';
  if (f.batchLimit > 8) w.batchLimit = 'Above 8 in a row recommended, raises ban risk';
  return w;
}
