import { describe, it, expect } from 'vitest';
import { summarizeWorker, pillSummary, type JobRow, type Recipient } from './worker-state';

const NOW = 1_000_000;

function job(p: Partial<JobRow> & Pick<JobRow, 'id' | 'kind' | 'status'>): JobRow {
  return {
    progress: null,
    created_at: NOW - 1000,
    started_at: null,
    finished_at: null,
    ...p,
  };
}

// Resolver that fakes invite→contact: encodes the name in the job id.
const NAMES: Record<number, string> = { 1: 'Alice', 2: 'Bob', 3: 'Carol', 4: 'Dave' };
const resolve = (j: JobRow): Recipient | null => {
  const name = NAMES[j.id];
  if (!name) return null;
  return { jobId: j.id, kind: j.kind, name, phone: `+1${j.id}`, at: j.finished_at };
};

const base = {
  now: NOW,
  running: [] as JobRow[],
  queued: [] as JobRow[],
  recentFinished: [] as JobRow[],
  resolveRecipient: resolve,
};

describe('summarizeWorker — liveness', () => {
  it('is connected when the beat is fresh', () => {
    const s = summarizeWorker({ ...base, heartbeat: { ts: NOW - 3000, startedAt: NOW - 60_000, pid: 7, node: 'v24' } });
    expect(s.connected).toBe(true);
    expect(s.beatAgeMs).toBe(3000);
    expect(s.uptimeMs).toBe(60_000);
    expect(s.pid).toBe(7);
  });

  it('is offline when the beat is stale', () => {
    const s = summarizeWorker({ ...base, heartbeat: { ts: NOW - 20_000, startedAt: NOW - 60_000 } });
    expect(s.connected).toBe(false);
    expect(s.uptimeMs).toBeNull(); // no uptime claim while offline
  });

  it('is offline when there is no heartbeat at all', () => {
    const s = summarizeWorker({ ...base, heartbeat: null });
    expect(s.connected).toBe(false);
    expect(s.beatAgeMs).toBeNull();
  });

  it('defaults limboCount to 0', () => {
    const s = summarizeWorker({ ...base, heartbeat: { ts: NOW } });
    expect(s.limboCount).toBe(0);
  });
});

describe('summarizeWorker — concurrent work and backlog', () => {
  it('lists running jobs and counts the queue by kind', () => {
    const s = summarizeWorker({
      ...base,
      heartbeat: { ts: NOW },
      running: [job({ id: 10, kind: 'draft_invite', status: 'running', progress: '60%' })],
      queued: [
        job({ id: 11, kind: 'draft_invite', status: 'queued' }),
        job({ id: 12, kind: 'draft_invite', status: 'queued' }),
        job({ id: 13, kind: 'check_replies', status: 'queued' }),
      ],
    });
    expect(s.running).toEqual([{ id: 10, kind: 'draft_invite', progress: '60%' }]);
    expect(s.queued.total).toBe(3);
    expect(s.queued.byKind).toEqual({ draft_invite: 2, check_replies: 1 });
  });

  it('reports the most recent finished job', () => {
    const s = summarizeWorker({
      ...base,
      heartbeat: { ts: NOW },
      recentFinished: [
        job({ id: 9, kind: 'send_message', status: 'succeeded', finished_at: NOW - 5 }),
        job({ id: 8, kind: 'draft_invite', status: 'succeeded', finished_at: NOW - 50 }),
      ],
    });
    expect(s.lastFinished).toEqual({ id: 9, kind: 'send_message', status: 'succeeded', finishedAt: NOW - 5 });
  });
});

describe('summarizeWorker — who sent / who is next', () => {
  it('resolves current send, next send, and recent sends by recipient name', () => {
    const s = summarizeWorker({
      ...base,
      heartbeat: { ts: NOW },
      running: [job({ id: 2, kind: 'send_message', status: 'running' })], // sending to Bob
      queued: [
        job({ id: 3, kind: 'send_message', status: 'queued' }), // next: Carol
        job({ id: 4, kind: 'send_follow_up', status: 'queued' }), // then Dave
        job({ id: 99, kind: 'draft_invite', status: 'queued' }), // not a send
      ],
      recentFinished: [job({ id: 1, kind: 'send_message', status: 'succeeded', finished_at: NOW - 10 })], // sent: Alice
    });
    expect(s.sends.current?.name).toBe('Bob');
    expect(s.sends.next?.name).toBe('Carol');
    expect(s.sends.queuedCount).toBe(2); // Carol + Dave, draft_invite excluded
    expect(s.sends.recent.map((r) => r.name)).toEqual(['Alice']);
  });

  it('drops failed sends and unresolvable recipients from recent', () => {
    const s = summarizeWorker({
      ...base,
      heartbeat: { ts: NOW },
      recentFinished: [
        job({ id: 1, kind: 'send_message', status: 'succeeded', finished_at: NOW - 1 }), // Alice
        job({ id: 5, kind: 'send_message', status: 'succeeded', finished_at: NOW - 2 }), // unresolvable
        job({ id: 2, kind: 'send_message', status: 'failed', finished_at: NOW - 3 }), // failed → excluded
      ],
    });
    expect(s.sends.recent.map((r) => r.name)).toEqual(['Alice']);
  });
});

describe('pillSummary', () => {
  const live = (over: Partial<ReturnType<typeof summarizeWorker>>) =>
    pillSummary({ ...summarizeWorker({ ...base, heartbeat: { ts: NOW } }), ...over });

  it('shows offline when not connected', () => {
    expect(pillSummary(summarizeWorker({ ...base, heartbeat: null })).tone).toBe('down');
  });
  it('prioritizes the current recipient', () => {
    const r = live({ sends: { current: { jobId: 2, kind: 'send_message', name: 'Bob', phone: null, at: null }, next: null, recent: [], queuedCount: 1 } });
    expect(r).toEqual({ tone: 'busy', text: 'sending to Bob' });
  });
  it('falls back to running job count', () => {
    expect(live({ running: [{ id: 1, kind: 'draft_invite', progress: null }, { id: 2, kind: 'draft_invite', progress: null }] }).text).toBe('working · 2 jobs');
  });
  it('shows idle when connected with nothing to do', () => {
    expect(live({}).tone).toBe('idle');
  });
});
