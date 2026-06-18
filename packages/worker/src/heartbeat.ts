import { setSetting } from '@event-drafter/core/settings';

let _lastBeat = 0;
const BEAT_INTERVAL_MS = 5000;

/** Updates worker_heartbeat at most once every BEAT_INTERVAL_MS. */
export function beat(): void {
  const now = Date.now();
  if (now - _lastBeat < BEAT_INTERVAL_MS) return;
  _lastBeat = now;
  setSetting('worker_heartbeat', { ts: now, node: process.version });
}
