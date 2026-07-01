// Turns raw job rows into a stream of "the worker started X" / "the worker
// finished X" events, and maps each to human toast copy. Pure and DB-free so it
// unit-tests without a database: the route hands in already-fetched rows plus a
// name resolver, this shapes them into events the client toasts.
import { isSendKind } from './worker-state';

/** Toast tones we emit. Structurally matches ToastProvider's ToastTone so the
 *  client can pass a described event straight into show(). */
export type EventTone = 'info' | 'success' | 'error';

export type EventPhase = 'started' | 'finished';

/** The subset of a job row the event builder needs. */
export interface WorkerJobRow {
  id: number;
  kind: string;
  status: string;
  started_at: number | null;
  finished_at: number | null;
  last_error?: string | null;
  /** Resolved recipient name for send kinds, else null. */
  recipient?: string | null;
}

export interface WorkerEvent {
  /** Stable client-side dedupe key: one toast per (job, phase). */
  key: string;
  jobId: number;
  kind: string;
  phase: EventPhase;
  status: string;
  at: number;
  recipient?: string | null;
  error?: string | null;
}

export interface WorkerEventsResult {
  events: WorkerEvent[];
  /** Newest event time seen (or `since` when nothing new), for the next poll. */
  cursor: number;
}

const FINISHED = new Set(['succeeded', 'failed']);

/**
 * Build the ordered event list from job rows.
 * - A "started" event for every row whose started_at is at/after `since`.
 * - A "finished" event for every succeeded/failed row whose finished_at is
 *   at/after `since`.
 * The `>= since` bound (rather than `>`) means the boundary event can repeat
 * across polls; the client dedupes by `key`, so that is harmless and avoids
 * dropping same-millisecond events.
 */
export function buildWorkerEvents(rows: WorkerJobRow[], since: number): WorkerEventsResult {
  const events: WorkerEvent[] = [];
  for (const r of rows) {
    if (r.started_at != null && r.started_at >= since) {
      events.push({
        key: `${r.id}:started`,
        jobId: r.id,
        kind: r.kind,
        phase: 'started',
        status: r.status,
        at: r.started_at,
        recipient: r.recipient ?? null,
      });
    }
    if (r.finished_at != null && r.finished_at >= since && FINISHED.has(r.status)) {
      events.push({
        key: `${r.id}:finished`,
        jobId: r.id,
        kind: r.kind,
        phase: 'finished',
        status: r.status,
        at: r.finished_at,
        recipient: r.recipient ?? null,
        error: r.status === 'failed' ? r.last_error ?? null : null,
      });
    }
  }
  events.sort((a, b) => a.at - b.at || a.jobId - b.jobId);
  const cursor = events.reduce((m, e) => Math.max(m, e.at), since);
  return { events, cursor };
}

/** Human phrasing per job kind: [doing, done]. */
const PHRASES: Record<string, { doing: string; done: string }> = {
  check_replies: { doing: 'Checking for replies', done: 'Checked for replies' },
  draft_invite: { doing: 'Drafting an invite', done: 'Invite drafted' },
  generate_follow_ups: { doing: 'Generating follow-ups', done: 'Follow-ups ready' },
  cleanup_jobs: { doing: 'Tidying up old jobs', done: 'Old jobs cleaned up' },
};

/** Send kinds read better with the recipient's name woven in. */
function sendPhrase(kind: string, phase: EventPhase, name: string): string {
  const who = phase === 'started' ? 'Sending' : 'Sent';
  if (kind === 'send_message') return `${who} invite to ${name}`;
  if (kind === 'send_follow_up') return `${who} follow-up to ${name}`;
  return `${who} reply to ${name}`; // send_response
}

export interface DescribedEvent {
  tone: EventTone;
  title: string;
  body?: string;
  /** ms before auto-dismiss; null keeps failures until acknowledged. */
  duration: number | null;
}

/** Map an event to the toast to show for it. */
export function describeWorkerEvent(e: WorkerEvent): DescribedEvent {
  const failed = e.phase === 'finished' && e.status === 'failed';

  let title: string;
  if (isSendKind(e.kind)) {
    const name = e.recipient ?? 'someone';
    title = failed
      ? `Could not send to ${name}`
      : sendPhrase(e.kind, e.phase, name);
  } else {
    const p = PHRASES[e.kind];
    if (failed) {
      title = p ? `${p.doing} failed` : `${humanKind(e.kind)} failed`;
    } else if (p) {
      title = e.phase === 'started' ? p.doing : p.done;
    } else {
      title = e.phase === 'started' ? `Working: ${humanKind(e.kind)}` : `Done: ${humanKind(e.kind)}`;
    }
  }

  if (failed) {
    return { tone: 'error', title, body: e.error ?? undefined, duration: null };
  }
  if (e.phase === 'started') {
    return { tone: 'info', title, duration: 4000 };
  }
  return { tone: 'success', title, duration: 5000 };
}

/** "send_follow_up" → "Send follow up" for unknown-kind fallbacks. */
function humanKind(kind: string): string {
  const s = kind.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
