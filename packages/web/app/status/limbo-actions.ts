'use server';

import { getDb } from '@/lib/db';
import { invites, follow_ups, replies, jobs } from '@event-drafter/core/schema';
import { and, eq, sql } from 'drizzle-orm';
import { readLimbo } from '@/lib/limbo-read';
import type { LimboType } from '@/lib/limbo';

type DbHandle = ReturnType<typeof getDb>;

export async function listLimbo() {
  return readLimbo();
}

interface Desc {
  sendKind: 'send_message' | 'send_follow_up' | 'send_response';
  payloadKey: 'invite_id' | 'follow_up_id' | 'reply_id';
  markSent: (db: DbHandle, id: number) => void;
  reApprove: (db: DbHandle, id: number) => void;
}

const DESC: Record<LimboType, Desc> = {
  invite: {
    sendKind: 'send_message',
    payloadKey: 'invite_id',
    markSent: (db, id) => db.update(invites).set({ status: 'sent', sent_at: new Date() }).where(eq(invites.id, id)).run(),
    reApprove: (db, id) => db.update(invites).set({ status: 'approved', approved_at: new Date(), prefilled_at: null, sent_at: null }).where(eq(invites.id, id)).run(),
  },
  follow_up: {
    sendKind: 'send_follow_up',
    payloadKey: 'follow_up_id',
    markSent: (db, id) => db.update(follow_ups).set({ status: 'sent', sent_at: new Date() }).where(eq(follow_ups.id, id)).run(),
    reApprove: (db, id) => db.update(follow_ups).set({ status: 'approved', approved_at: new Date(), prefilled_at: null, sent_at: null }).where(eq(follow_ups.id, id)).run(),
  },
  reply: {
    sendKind: 'send_response',
    payloadKey: 'reply_id',
    markSent: (db, id) => db.update(replies).set({ response_status: 'sent', response_sent_at: new Date() }).where(eq(replies.id, id)).run(),
    reApprove: (db, id) => db.update(replies).set({ response_status: 'approved', response_approved_at: new Date(), response_prefilled_at: null, response_sent_at: null }).where(eq(replies.id, id)).run(),
  },
};

/** Fail the stuck running send job for this record so it stops reading as in-flight. */
function failOrphanJob(db: DbHandle, d: Desc, id: number): void {
  db.update(jobs)
    .set({ status: 'failed', finished_at: new Date(), last_error: 'superseded by operator recovery' })
    .where(and(eq(jobs.status, 'running'), eq(jobs.kind, d.sendKind), sql`json_extract(${jobs.payload}, ${'$.' + d.payloadKey}) = ${id}`))
    .run();
}

/** Core resend logic — must run inside a caller-owned transaction. */
function resendOne(tx: DbHandle, type: LimboType, id: number): void {
  const d = DESC[type];
  d.reApprove(tx, id);
  failOrphanJob(tx, d, id);
  tx.insert(jobs).values({ kind: d.sendKind, payload: { [d.payloadKey]: id } }).run();
}

export async function recoverMarkSent(input: { type: LimboType; id: number }) {
  const d = DESC[input.type];
  const db = getDb();
  db.transaction((tx) => {
    d.markSent(tx, input.id);
    failOrphanJob(tx, d, input.id);
  });
}

export async function recoverResend(input: { type: LimboType; id: number }) {
  getDb().transaction((tx) => resendOne(tx, input.type, input.id));
}

export async function recoverResendAllPrefilled(): Promise<{ resent: number }> {
  const prefilled = readLimbo().records.filter((r) => r.state === 'prefilled');
  getDb().transaction((tx) => {
    for (const r of prefilled) resendOne(tx, r.type, r.id);
  });
  return { resent: prefilled.length };
}
