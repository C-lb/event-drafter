'use server';

import { getDb } from '@event-drafter/core/db';
import { events, invites, jobs } from '@event-drafter/core/schema';
import { setSetting } from '@event-drafter/core/settings';
import { and, eq, inArray, isNull, notInArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

export async function triggerCleanup(): Promise<void> {
  const db = getDb();
  const existing = db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.kind, 'cleanup_jobs'), inArray(jobs.status, ['queued', 'running'])))
    .get();
  if (!existing) {
    db.insert(jobs).values({ kind: 'cleanup_jobs', payload: {}, status: 'queued' }).run();
  }
  revalidatePath('/status');
}

// Job kinds that deliver a WhatsApp message. Never re-queued by a restart —
// resurrecting a half-finished send could fire the same message twice.
const SEND_KINDS = ['send_message', 'send_follow_up', 'send_response'] as const;

export interface RestartResult {
  orphansPurged: number;
  requeued: number;
  drafted: number;
  rechecked: boolean;
  followUps: boolean;
}

/**
 * Restart-and-recheck from the web UI. All work is DB writes the running worker
 * picks up; it cannot start a worker that is fully down (see the /status helper
 * text). Steps:
 *   1. Purge orphaned draft jobs whose event was deleted.
 *   2. Re-queue failed / stuck-running non-send jobs so the worker retries them.
 *   3. Enqueue a fresh draft_invite for every undrafted, still-pending invite.
 *   4. Enqueue check_replies and generate_follow_ups (if none already pending).
 *   5. Signal the worker to soft-restart (re-run its startup catch-up).
 */
export async function restartWorker(): Promise<RestartResult> {
  const db = getDb();
  const result: RestartResult = {
    orphansPurged: 0,
    requeued: 0,
    drafted: 0,
    rechecked: false,
    followUps: false,
  };

  // 1. Purge orphaned draft jobs (event deleted out from under them).
  const liveEventIds = new Set(db.select({ id: events.id }).from(events).all().map((e) => e.id));
  const draftJobs = db
    .select({ id: jobs.id, payload: jobs.payload })
    .from(jobs)
    .where(eq(jobs.kind, 'draft_invite'))
    .all();
  const orphanIds = draftJobs
    .filter((j) => {
      const evId = (j.payload as { event_id?: number } | null)?.event_id;
      return evId == null || !liveEventIds.has(evId);
    })
    .map((j) => j.id);
  if (orphanIds.length > 0) {
    db.delete(jobs).where(inArray(jobs.id, orphanIds)).run();
    result.orphansPurged = orphanIds.length;
  }

  // 2. Re-queue failed / stuck-running NON-send jobs so the worker retries them.
  const requeued = db
    .update(jobs)
    .set({ status: 'queued', started_at: null, finished_at: null, last_error: null })
    .where(
      and(
        inArray(jobs.status, ['failed', 'running']),
        notInArray(jobs.kind, [...SEND_KINDS]),
      ),
    )
    .run();
  result.requeued = requeued.changes;

  // 3. Re-draft invites that never got a draft (pending + no draft text), whose
  //    event still exists and that don't already have an active draft job.
  const activeDraftPairs = new Set(
    db
      .select({ payload: jobs.payload })
      .from(jobs)
      .where(and(eq(jobs.kind, 'draft_invite'), inArray(jobs.status, ['queued', 'running'])))
      .all()
      .map((j) => {
        const p = j.payload as { event_id?: number; contact_id?: number } | null;
        return `${p?.event_id}:${p?.contact_id}`;
      }),
  );
  const undrafted = db
    .select({ event_id: invites.event_id, contact_id: invites.contact_id })
    .from(invites)
    .where(and(eq(invites.status, 'pending'), isNull(invites.draft_text)))
    .all();
  for (const inv of undrafted) {
    if (!liveEventIds.has(inv.event_id)) continue;
    if (activeDraftPairs.has(`${inv.event_id}:${inv.contact_id}`)) continue;
    db.insert(jobs)
      .values({ kind: 'draft_invite', payload: { event_id: inv.event_id, contact_id: inv.contact_id } })
      .run();
    result.drafted++;
  }

  // 4. Recheck replies and regenerate follow-ups (skip if one is already pending).
  const hasActive = (kind: 'check_replies' | 'generate_follow_ups') =>
    db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.kind, kind), inArray(jobs.status, ['queued', 'running'])))
      .get();

  if (!hasActive('check_replies')) {
    db.insert(jobs).values({ kind: 'check_replies', payload: {} }).run();
    result.rechecked = true;
  }
  if (!hasActive('generate_follow_ups')) {
    db.insert(jobs).values({ kind: 'generate_follow_ups', payload: {} }).run();
    result.followUps = true;
  }

  // 5. Signal the running worker to soft-restart (re-run startup catch-up).
  setSetting('worker_restart_requested', { ts: Date.now() });

  revalidatePath('/status');
  return result;
}
