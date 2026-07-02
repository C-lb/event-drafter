import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSetting } from '@event-drafter/core/settings';
import { readLimbo } from '@/lib/limbo-read';
import { jobs } from '@event-drafter/core/schema';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import { summarizeWorker, type JobRow } from '@/lib/worker-state';
import { resolveRecipient } from '@/lib/recipient';
import { getRateLimitState } from '@event-drafter/worker/rate-limit';

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

  const state = summarizeWorker({
    heartbeat,
    now: Date.now(),
    running,
    queued,
    recentFinished,
    resolveRecipient: (job: JobRow) => resolveRecipient(db, job),
  });
  const limboCount = readLimbo().count;
  const safetyStopped = getSetting('worker_safety_stop')?.engaged === true;
  const rateLimit = getRateLimitState();
  return NextResponse.json({ ...state, limboCount, safetyStopped, rateLimit }, { headers: { 'Cache-Control': 'no-store' } });
}
