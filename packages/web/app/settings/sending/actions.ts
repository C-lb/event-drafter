'use server';

import { z } from 'zod';
import { getSetting, setSetting } from '@event-drafter/core/settings';
import { getDb } from '@/lib/db';
import { jobs } from '@event-drafter/core/schema';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { toMs, fromMs, FORM_DEFAULTS, type RateLimitMs } from '@/lib/rate-limit-form';

const SEND_KINDS = ['send_message', 'send_follow_up', 'send_response'] as const;

// Defaults come from the local form module (same numbers as the worker's
// RATE_LIMIT_DEFAULTS), so this action has no build-order dependency on the
// worker's dist.
export async function getRateLimitMs(): Promise<RateLimitMs> {
  const o = getSetting('rate_limit_config') ?? {};
  return { ...toMs(FORM_DEFAULTS), ...o };
}

const DAY = 24 * 60 * 60_000;

const schema = z
  .object({
    minGapMs: z.number().int().positive().max(DAY),
    maxGapMs: z.number().int().positive().max(DAY),
    batchLimit: z.number().int().min(1).max(1000),
    cooldownMinMs: z.number().int().positive().max(DAY),
    cooldownMaxMs: z.number().int().positive().max(DAY),
    maxSendsPerHour: z.number().int().min(1).max(10_000),
  })
  .refine((v) => v.maxGapMs >= v.minGapMs, {
    message: 'max gap must be >= min gap',
    path: ['maxGapMs'],
  })
  .refine((v) => v.cooldownMaxMs >= v.cooldownMinMs, {
    message: 'max cooldown must be >= min cooldown',
    path: ['cooldownMaxMs'],
  });

export async function saveRateLimit(
  input: unknown,
): Promise<{ ok: true; repaced: number } | { ok: false; error: string }> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' };
  }
  setSetting('rate_limit_config', parsed.data);

  // IMMEDIATE APPLY (even mid-wait): clear run_after on deferred send jobs so the
  // poller re-evaluates them under the NEW limits on its next tick (~1s), instead
  // of sitting on a run_after computed under the OLD gap.
  const db = getDb();
  const res = db
    .update(jobs)
    .set({ run_after: null })
    .where(
      and(
        inArray(jobs.kind, [...SEND_KINDS]),
        eq(jobs.status, 'queued'),
        isNotNull(jobs.run_after),
      ),
    )
    .run();

  return { ok: true, repaced: (res as { changes: number }).changes };
}
