// Resolves a send job to the human it is being sent to, by walking
// payload → invite → contact. Shared by the worker-state and worker-events
// routes so the resolution lives in exactly one place.
import { getDb } from './db';
import { invites, contacts, follow_ups, replies } from '@event-drafter/core/schema';
import { eq } from 'drizzle-orm';
import { isSendKind, type JobRow, type Recipient } from './worker-state';

type Db = ReturnType<typeof getDb>;

/** The invite a send job targets, chasing follow_up/reply back to the invite. */
function resolveInviteId(db: Db, job: JobRow): number | undefined {
  const p = job.payload ?? {};
  if (job.kind === 'send_message') return p.invite_id as number | undefined;
  if (job.kind === 'send_follow_up') {
    const fu = db.select().from(follow_ups).where(eq(follow_ups.id, p.follow_up_id as number)).get();
    return fu?.invite_id;
  }
  if (job.kind === 'send_response') {
    const r = db.select().from(replies).where(eq(replies.id, p.reply_id as number)).get();
    return r?.invite_id;
  }
  return undefined;
}

/** Full recipient (name + phone + finish time) for the state indicator. */
export function resolveRecipient(db: Db, job: JobRow): Recipient | null {
  if (!isSendKind(job.kind)) return null;
  const inviteId = resolveInviteId(db, job);
  if (inviteId == null) return null;
  const inv = db.select().from(invites).where(eq(invites.id, inviteId)).get();
  if (!inv) return null;
  const c = db.select().from(contacts).where(eq(contacts.id, inv.contact_id)).get();
  if (!c) return null;
  const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || c.phone_e164;
  return { jobId: job.id, kind: job.kind, name, phone: c.phone_e164, at: job.finished_at };
}

/** Just the display name for a send job (or null for non-send kinds). */
export function resolveRecipientName(db: Db, job: JobRow): string | null {
  return resolveRecipient(db, job)?.name ?? null;
}
