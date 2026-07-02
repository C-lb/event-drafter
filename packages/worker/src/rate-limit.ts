import { getDb } from '@event-drafter/core/db';
import { jobs } from '@event-drafter/core/schema';
import { and, eq, gte, sql } from 'drizzle-orm';
import { getSetting } from '@event-drafter/core/settings';

// See CONTEXT.md → "Sending cadence". Numbers calibrated to mimic a human
// typing each message in WhatsApp Web. Operator-tunable.
//
// 2026-06-11: operator lowered MIN_GAP_MS from 179s to 30s (acknowledged
// raised WA ban risk). Adjust together if relaxing further.
// 2026-06-12: operator lowered gap to 10 s (jitter to 15 s).
// 2026-06-30: knobs now adjustable via settings (rate_limit_config); no
// worker restart needed.

export interface RateLimitConfig {
  minGapMs: number;
  maxGapMs: number;
  batchLimit: number;
  cooldownMinMs: number;
  cooldownMaxMs: number;
  maxSendsPerHour: number;
}

export const RATE_LIMIT_DEFAULTS: RateLimitConfig = {
  minGapMs: 10_000,
  maxGapMs: 15_000,
  batchLimit: 8,
  cooldownMinMs: 15 * 60_000,
  cooldownMaxMs: 30 * 60_000,
  maxSendsPerHour: 18,
};

/** Settings override merged over defaults; invalid fields fall back. Read per
 *  call so a saved change applies on the next send (no worker restart). */
export function getRateLimitConfig(): RateLimitConfig {
  const o = (getSetting('rate_limit_config') ?? {}) as Partial<RateLimitConfig>;
  const pos = (v: unknown, d: number) =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : d;
  const c: RateLimitConfig = {
    minGapMs: pos(o.minGapMs, RATE_LIMIT_DEFAULTS.minGapMs),
    maxGapMs: pos(o.maxGapMs, RATE_LIMIT_DEFAULTS.maxGapMs),
    batchLimit: pos(o.batchLimit, RATE_LIMIT_DEFAULTS.batchLimit),
    cooldownMinMs: pos(o.cooldownMinMs, RATE_LIMIT_DEFAULTS.cooldownMinMs),
    cooldownMaxMs: pos(o.cooldownMaxMs, RATE_LIMIT_DEFAULTS.cooldownMaxMs),
    maxSendsPerHour: pos(o.maxSendsPerHour, RATE_LIMIT_DEFAULTS.maxSendsPerHour),
  };
  if (c.maxGapMs < c.minGapMs) c.maxGapMs = c.minGapMs;
  if (c.cooldownMaxMs < c.cooldownMinMs) c.cooldownMaxMs = c.cooldownMinMs;
  return c;
}

/** Backward-compatible alias for existing consumers (e.g. web actions.ts). */
export const RATE_LIMIT_CONFIG = RATE_LIMIT_DEFAULTS;

export type RateLimitReason = 'gap' | 'cooldown' | 'hourly';

export interface RateLimitState {
  delayMs: number | null;
  reason: RateLimitReason | null;
  inBatch: number;
  sentLastHour: number;
  lastSendAtMs: number | null;
}

/** Returns full rate-limit state for UI display (countdown + diagnostics). */
export function getRateLimitState(now: Date = new Date()): RateLimitState {
  const cfg = getRateLimitConfig();
  const db = getDb();
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  const sentLastHour = (db
    .select({ count: sql<number>`count(*)` })
    .from(jobs)
    .where(and(eq(jobs.kind, 'send_message'), eq(jobs.status, 'succeeded'), gte(jobs.finished_at, hourAgo)))
    .all()[0]?.count ?? 0) as number;

  const last = db
    .select({ finished_at: jobs.finished_at })
    .from(jobs)
    .where(and(eq(jobs.kind, 'send_message'), eq(jobs.status, 'succeeded')))
    .orderBy(sql`${jobs.finished_at} DESC`)
    .limit(1)
    .all()[0];
  const lastSendAtMs = (last?.finished_at as Date | undefined)?.getTime() ?? null;

  const delayMs = sendDelayMs(now);
  let reason: RateLimitReason | null = null;
  if (delayMs !== null) {
    if (sentLastHour >= cfg.maxSendsPerHour) reason = 'hourly';
    else if (consecutiveSendsInBatch(now) >= cfg.batchLimit) reason = 'cooldown';
    else reason = 'gap';
  }

  return {
    delayMs,
    reason,
    inBatch: consecutiveSendsInBatch(now),
    sentLastHour: Number(sentLastHour),
    lastSendAtMs,
  };
}

/** Random gap in ms within [minGapMs, maxGapMs]. */
export function jitterMs(): number {
  const cfg = getRateLimitConfig();
  return cfg.minGapMs + Math.floor(Math.random() * (cfg.maxGapMs - cfg.minGapMs + 1));
}

/** Random cool-down in ms within [cooldownMinMs, cooldownMaxMs]. */
export function cooldownMs(): number {
  const cfg = getRateLimitConfig();
  return cfg.cooldownMinMs + Math.floor(Math.random() * (cfg.cooldownMaxMs - cfg.cooldownMinMs + 1));
}

/**
 * Counts consecutive succeeded send_message jobs walking back from `now`,
 * stopping at the first gap >= cooldownMinMs (which we interpret as a
 * batch break). Bounded scan of the last 50 sends.
 */
function consecutiveSendsInBatch(now: Date): number {
  const cfg = getRateLimitConfig();
  const db = getDb();
  const rows = db
    .select({ finished_at: jobs.finished_at })
    .from(jobs)
    .where(and(eq(jobs.kind, 'send_message'), eq(jobs.status, 'succeeded')))
    .orderBy(sql`${jobs.finished_at} DESC`)
    .limit(50)
    .all();

  let count = 0;
  let prevMs: number | null = null;
  for (const r of rows) {
    const t = (r.finished_at as Date | undefined)?.getTime();
    if (!t) break;
    if (prevMs === null) {
      // gap from now → newest send. If we're already past a cool-down, batch is fresh.
      if (now.getTime() - t >= cfg.cooldownMinMs) return 0;
    } else {
      if (prevMs - t >= cfg.cooldownMinMs) break;
    }
    count++;
    prevMs = t;
  }
  return count;
}

/**
 * Returns null if a new send is allowed now, or a delay in ms until the
 * next send becomes allowed. Enforces three layers:
 *
 *   1. Hard hourly cap (maxSendsPerHour)
 *   2. Batch cool-down (after batchLimit consecutive sends)
 *   3. Per-message floor (minGapMs)
 */
export function sendDelayMs(now: Date = new Date()): number | null {
  const cfg = getRateLimitConfig();
  const db = getDb();
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  // 1. Hourly cap.
  const countRow = db
    .select({ count: sql<number>`count(*)` })
    .from(jobs)
    .where(
      and(
        eq(jobs.kind, 'send_message'),
        eq(jobs.status, 'succeeded'),
        gte(jobs.finished_at, hourAgo),
      ),
    )
    .all()[0];
  const count = countRow?.count ?? 0;

  if (count >= cfg.maxSendsPerHour) {
    const oldest = db
      .select({ finished_at: jobs.finished_at })
      .from(jobs)
      .where(
        and(
          eq(jobs.kind, 'send_message'),
          eq(jobs.status, 'succeeded'),
          gte(jobs.finished_at, hourAgo),
        ),
      )
      .orderBy(jobs.finished_at)
      .limit(1)
      .all();
    const oldestMs = (oldest[0]?.finished_at as Date | undefined)?.getTime();
    if (oldestMs) {
      const delay = oldestMs + 60 * 60 * 1000 - now.getTime() + 1000;
      return Math.max(delay, 60_000);
    }
    return 60 * 60 * 1000;
  }

  // Most recent succeeded send.
  const last = db
    .select({ finished_at: jobs.finished_at })
    .from(jobs)
    .where(and(eq(jobs.kind, 'send_message'), eq(jobs.status, 'succeeded')))
    .orderBy(sql`${jobs.finished_at} DESC`)
    .limit(1)
    .all()[0];
  const lastMs = (last?.finished_at as Date | undefined)?.getTime();

  // 2. Batch cool-down.
  const inBatch = consecutiveSendsInBatch(now);
  if (inBatch >= cfg.batchLimit && lastMs) {
    const since = now.getTime() - lastMs;
    if (since < cfg.cooldownMinMs) return cfg.cooldownMinMs - since;
  }

  // 3. Per-message floor.
  if (lastMs) {
    const since = now.getTime() - lastMs;
    if (since < cfg.minGapMs) return cfg.minGapMs - since;
  }

  return null;
}
