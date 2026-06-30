import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSetting } from '@event-drafter/core/settings';
import { readLimbo } from '@/lib/limbo-read';
import { jobs, invites, contacts, follow_ups, replies } from '@event-drafter/core/schema';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import {
  summarizeWorker,
  isSendKind,
  type JobRow,
  type Recipient,
} from '@/lib/worker-state';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function toMs(v: unknown): number | null {
  if (v == null) return null;
  if (v instanceof Date) return v.getTime();
  return Number(v);
}

type DbJob = typeof jobs.$inferSelect;

function toRow(j: DbJob): JobRow {
  return {
    id: j.id,
    kind: j.kind,
    status: j.status,
    progress: j.progress,
    created_at: toMs(j.created_at) ?? 0,
    started_at: toMs(j.started_at),
    finished_at: toMs(j.finished_at),
    payload: j.payload,
  };
}

export async function GET() {
  const db = getDb();
  const heartbeat = getSetting('worker_heartbeat');

  const running = db
    .select()
    .from(jobs)
    .where(eq(jobs.status, 'running'))
    .orderBy(asc(jobs.started_at))
    .all()
    .map(toRow);

  const queued = db
    .select()
    .from(jobs)
    .where(eq(jobs.status, 'queued'))
    .orderBy(asc(jobs.created_at))
    .limit(1000)
    .all()
    .map(toRow);

  const recentFinished = db
    .select()
    .from(jobs)
    .where(inArray(jobs.status, ['succeeded', 'failed']))
    .orderBy(desc(jobs.finished_at), desc(jobs.id))
    .limit(20)
    .all()
    .map(toRow);

  // Resolve a send job to its recipient by walking payload → invite → contact.
  // send_message:   payload.invite_id
  // send_follow_up: payload.follow_up_id → follow_ups.invite_id
  // send_response:  payload.reply_id     → replies.invite_id
  function resolveRecipient(job: JobRow): Recipient | null {
    if (!isSendKind(job.kind)) return null;
    const p = job.payload ?? {};
    let inviteId: number | undefined;
    if (job.kind === 'send_message') {
      inviteId = p.invite_id as number | undefined;
    } else if (job.kind === 'send_follow_up') {
      const fu = db.select().from(follow_ups).where(eq(follow_ups.id, p.follow_up_id as number)).get();
      inviteId = fu?.invite_id;
    } else if (job.kind === 'send_response') {
      const r = db.select().from(replies).where(eq(replies.id, p.reply_id as number)).get();
      inviteId = r?.invite_id;
    }
    if (inviteId == null) return null;
    const inv = db.select().from(invites).where(eq(invites.id, inviteId)).get();
    if (!inv) return null;
    const c = db.select().from(contacts).where(eq(contacts.id, inv.contact_id)).get();
    if (!c) return null;
    const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || c.phone_e164;
    return { jobId: job.id, kind: job.kind, name, phone: c.phone_e164, at: job.finished_at };
  }

  const state = summarizeWorker({
    heartbeat,
    now: Date.now(),
    running,
    queued,
    recentFinished,
    resolveRecipient,
  });
  const limboCount = readLimbo().count;
  return NextResponse.json({ ...state, limboCount }, { headers: { 'Cache-Control': 'no-store' } });
}
