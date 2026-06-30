// Shapes the worker's liveness + queue into the snapshot the always-on header
// indicator renders. Pure: all DB I/O happens in the API route, which hands the
// already-fetched rows (and a recipient resolver) in here. That keeps the
// connected/offline + "who sent / who's next" logic unit-testable without a DB.

/** Job kinds that deliver a real WhatsApp message (run strictly one-at-a-time). */
export const SEND_KINDS = ['send_message', 'send_follow_up', 'send_response'] as const;
export type SendKind = (typeof SEND_KINDS)[number];

export function isSendKind(kind: string): kind is SendKind {
  return (SEND_KINDS as readonly string[]).includes(kind);
}

/** A heartbeat older than this means the worker is considered offline. Matches
 *  the worker's 5s beat interval with margin for a slow tick. */
export const STALE_MS = 15_000;

export interface Heartbeat {
  ts: number;
  node?: string;
  startedAt?: number;
  pid?: number;
}

export interface JobRow {
  id: number;
  kind: string;
  status: string;
  progress: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  /** Raw job payload — only the route's recipient resolver reads it. */
  payload?: Record<string, unknown>;
}

/** A send target resolved to a human name (worker resolves invite→contact). */
export interface Recipient {
  jobId: number;
  kind: string;
  name: string;
  phone: string | null;
  /** When the send finished (recent) — null for in-flight/next. */
  at: number | null;
}

export interface WorkerState {
  connected: boolean;
  beatAgeMs: number | null;
  node: string | null;
  startedAt: number | null;
  uptimeMs: number | null;
  pid: number | null;
  /** Jobs the worker is running right now. When offline these are the tasks it
   *  was mid-way through when it died (left stuck at 'running'). */
  running: { id: number; kind: string; progress: string | null }[];
  queued: { total: number; byKind: Record<string, number> };
  lastFinished: { id: number; kind: string; status: string; finishedAt: number | null } | null;
  sends: {
    /** The recipient being messaged right now (sends are serial, so ≤1). */
    current: Recipient | null;
    /** The next person in line to be messaged. */
    next: Recipient | null;
    /** Who it has just sent to, newest first. */
    recent: Recipient[];
    /** How many send jobs are still waiting. */
    queuedCount: number;
  };
  /** Count of messages caught mid-send that need an operator decision. */
  limboCount: number;
  /** True while the operator has engaged the emergency safety stop. */
  safetyStopped: boolean;
}

export interface SummarizeInput {
  heartbeat: Heartbeat | null;
  now: number;
  /** status = 'running' rows. */
  running: JobRow[];
  /** status = 'queued' rows, oldest first (FIFO = send order). */
  queued: JobRow[];
  /** terminal rows (succeeded/failed), newest first. */
  recentFinished: JobRow[];
  /** Resolves a send job to its recipient; null if it can't be resolved. */
  resolveRecipient: (job: JobRow) => Recipient | null;
  /** How many recent sends to surface. */
  recentSends?: number;
}

export function summarizeWorker(input: SummarizeInput): WorkerState {
  const { heartbeat, now, running, queued, recentFinished, resolveRecipient } = input;
  const recentSends = input.recentSends ?? 5;

  const beatAgeMs = heartbeat ? Math.max(0, now - heartbeat.ts) : null;
  const connected = beatAgeMs !== null && beatAgeMs < STALE_MS;
  const startedAt = heartbeat?.startedAt ?? null;

  const queuedByKind: Record<string, number> = {};
  for (const j of queued) queuedByKind[j.kind] = (queuedByKind[j.kind] ?? 0) + 1;

  const runningSend = running.find((j) => isSendKind(j.kind)) ?? null;
  const queuedSends = queued.filter((j) => isSendKind(j.kind));
  const nextSend = queuedSends[0] ?? null;
  const recentSendJobs = recentFinished
    .filter((j) => isSendKind(j.kind) && j.status === 'succeeded')
    .slice(0, recentSends);

  return {
    connected,
    beatAgeMs,
    node: heartbeat?.node ?? null,
    startedAt,
    uptimeMs: startedAt !== null && connected ? Math.max(0, now - startedAt) : null,
    pid: heartbeat?.pid ?? null,
    running: running.map((j) => ({ id: j.id, kind: j.kind, progress: j.progress })),
    queued: { total: queued.length, byKind: queuedByKind },
    lastFinished: recentFinished[0]
      ? {
          id: recentFinished[0].id,
          kind: recentFinished[0].kind,
          status: recentFinished[0].status,
          finishedAt: recentFinished[0].finished_at,
        }
      : null,
    sends: {
      current: runningSend ? resolveRecipient(runningSend) : null,
      next: nextSend ? resolveRecipient(nextSend) : null,
      recent: recentSendJobs.map(resolveRecipient).filter((r): r is Recipient => r !== null),
      queuedCount: queuedSends.length,
    },
    limboCount: 0,
    safetyStopped: false,
  };
}

export type PillTone = 'down' | 'busy' | 'idle';

/** Presentational summary for the header pill — kept pure so it's testable. */
export function pillSummary(state: WorkerState): { tone: PillTone; text: string } {
  if (state.safetyStopped) return { tone: 'down', text: 'safety stop on' };
  if (!state.connected) return { tone: 'down', text: 'worker offline' };
  if (state.sends.current) return { tone: 'busy', text: `sending to ${state.sends.current.name}` };
  if (state.running.length > 0) {
    return { tone: 'busy', text: `working · ${state.running.length} job${state.running.length > 1 ? 's' : ''}` };
  }
  if (state.queued.total > 0) return { tone: 'busy', text: `${state.queued.total} queued` };
  return { tone: 'idle', text: 'connected · idle' };
}
