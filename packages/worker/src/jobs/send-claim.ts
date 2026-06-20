import { getDb } from '@event-drafter/core/db';
import { invites, follow_ups, replies } from '@event-drafter/core/schema';
import { and, eq } from 'drizzle-orm';

/**
 * Per-record send claim — the single-send guarantee.
 *
 * Each helper performs an atomic compare-and-swap: `UPDATE ... SET status =
 * 'sending' WHERE id = ? AND status = 'approved'`. SQLite serialises writes, so
 * if two jobs (or two racing workers) target the same record, exactly one
 * UPDATE finds it still 'approved' and matches — that caller gets `changes === 1`
 * and is cleared to deliver the message. Every other caller gets `false` and
 * MUST NOT touch WhatsApp. Keyed on the record, not the job, so even two
 * separate send jobs for the same invite can't both send.
 *
 * The claim is taken BEFORE the WhatsApp action. If delivery is deferred or
 * fails before anything is sent, call the matching release to hand the record
 * back to 'approved' so a later attempt can re-claim it.
 */

export function claimInviteForSend(id: number): boolean {
  const res = getDb()
    .update(invites)
    .set({ status: 'sending' })
    .where(and(eq(invites.id, id), eq(invites.status, 'approved')))
    .run();
  return res.changes === 1;
}

export function releaseInviteClaim(id: number): void {
  getDb()
    .update(invites)
    .set({ status: 'approved' })
    .where(and(eq(invites.id, id), eq(invites.status, 'sending')))
    .run();
}

export function claimFollowUpForSend(id: number): boolean {
  const res = getDb()
    .update(follow_ups)
    .set({ status: 'sending' })
    .where(and(eq(follow_ups.id, id), eq(follow_ups.status, 'approved')))
    .run();
  return res.changes === 1;
}

export function releaseFollowUpClaim(id: number): void {
  getDb()
    .update(follow_ups)
    .set({ status: 'approved' })
    .where(and(eq(follow_ups.id, id), eq(follow_ups.status, 'sending')))
    .run();
}

export function claimResponseForSend(id: number): boolean {
  const res = getDb()
    .update(replies)
    .set({ response_status: 'sending' })
    .where(and(eq(replies.id, id), eq(replies.response_status, 'approved')))
    .run();
  return res.changes === 1;
}

export function releaseResponseClaim(id: number): void {
  getDb()
    .update(replies)
    .set({ response_status: 'approved' })
    .where(and(eq(replies.id, id), eq(replies.response_status, 'sending')))
    .run();
}
