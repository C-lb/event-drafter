import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { jobs } from '@event-drafter/core/schema';
import { gte, or, asc } from 'drizzle-orm';
import { buildWorkerEvents, type WorkerJobRow } from '@/lib/worker-events';
import { resolveRecipientName } from '@/lib/recipient';
import { isSendKind, type JobRow } from '@/lib/worker-state';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function toMs(v: unknown): number | null {
  if (v == null) return null;
  if (v instanceof Date) return v.getTime();
  return Number(v);
}

// Streams "worker started X / finished X" events since a client-held cursor.
// The client seeds `since` to page-load time so history is never replayed, then
// advances it to the returned `cursor`.
export async function GET(req: Request) {
  const db = getDb();
  const url = new URL(req.url);
  const sinceRaw = Number(url.searchParams.get('since'));
  const since = Number.isFinite(sinceRaw) ? sinceRaw : Date.now();
  const sinceDate = new Date(since);

  // Any job that started or finished at/after the cursor is a candidate.
  const rows = db
    .select()
    .from(jobs)
    .where(or(gte(jobs.started_at, sinceDate), gte(jobs.finished_at, sinceDate)))
    .orderBy(asc(jobs.id))
    .limit(200)
    .all();

  const shaped: WorkerJobRow[] = rows.map((j) => {
    const jobRow: JobRow = {
      id: j.id,
      kind: j.kind,
      status: j.status,
      progress: j.progress,
      created_at: toMs(j.created_at) ?? 0,
      started_at: toMs(j.started_at),
      finished_at: toMs(j.finished_at),
      payload: j.payload,
    };
    const p = j.payload ?? {};
    const batchIndex = typeof p.batch_index === 'number' ? p.batch_index : null;
    const batchSize = typeof p.batch_size === 'number' ? p.batch_size : null;
    return {
      id: j.id,
      kind: j.kind,
      status: j.status,
      started_at: jobRow.started_at,
      finished_at: jobRow.finished_at,
      last_error: j.last_error,
      recipient: isSendKind(j.kind) ? resolveRecipientName(db, jobRow) : null,
      batchIndex,
      batchSize,
    };
  });

  const { events, cursor } = buildWorkerEvents(shaped, since);
  return NextResponse.json({ events, cursor }, { headers: { 'Cache-Control': 'no-store' } });
}
