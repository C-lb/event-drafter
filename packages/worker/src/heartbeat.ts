import { setSetting } from '@event-drafter/core/settings';

let _lastBeat = 0;
// When this worker process started — lets the UI show uptime and notice a
// restart (a changed startedAt) even between beats.
const _startedAt = Date.now();
const BEAT_INTERVAL_MS = 5000;

/** Updates worker_heartbeat at most once every BEAT_INTERVAL_MS. */
export function beat(): void {
  const now = Date.now();
  if (now - _lastBeat < BEAT_INTERVAL_MS) return;
  _lastBeat = now;
  setSetting('worker_heartbeat', { ts: now, node: process.version, startedAt: _startedAt, pid: process.pid });
}

export interface HeartbeatHandle { stop(): void; }

/** Beats every 5s independent of the poll loop, so a long-running job does not
 *  let the heartbeat go stale (which would show the worker as offline while it
 *  is actually busy). Returns a handle to stop the timer (tests / shutdown). */
export function startHeartbeat(): HeartbeatHandle {
  beat(); // immediate first beat
  const id = setInterval(() => beat(), BEAT_INTERVAL_MS);
  if (typeof id === 'object' && 'unref' in id) (id as { unref: () => void }).unref();
  return { stop: () => clearInterval(id) };
}
