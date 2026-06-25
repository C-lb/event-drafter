'use client';

import { useEffect, useState } from 'react';
import { getRateLimitSnapshot } from '../actions';

type Snapshot = Awaited<ReturnType<typeof getRateLimitSnapshot>>;

function formatGap(ms: number): string {
  if (ms <= 0) return '0s';
  const totalSec = Math.ceil(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

function reasonLabel(reason: Snapshot['reason']): string {
  switch (reason) {
    case 'gap':
      return 'per-message gap';
    case 'cooldown':
      return 'batch cool-down';
    case 'hourly':
      return 'hourly cap';
    default:
      return '';
  }
}

export function RateLimitTimer() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  // Re-fetch the snapshot every 5s from the server (DB-backed, cheap),
  // and tick the local "now" every second so the countdown updates smoothly.
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const s = await getRateLimitSnapshot();
        if (alive) setSnap(s);
      } catch {
        /* swallow; will retry on next tick */
      }
    };
    refresh();
    const refreshTimer = setInterval(refresh, 5000);
    const tickTimer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      alive = false;
      clearInterval(refreshTimer);
      clearInterval(tickTimer);
    };
  }, []);

  if (!snap) {
    return (
      <div className="card-quiet p-4 text-xs text-ink-3">
        Rate-limit state loading…
      </div>
    );
  }

  // Adjust the snapshot's delay by how much real time has passed since
  // we last refreshed, so the countdown is smooth between server polls.
  const drift = now - snap.now;
  const liveDelay = snap.delayMs === null ? null : Math.max(0, snap.delayMs - drift);
  const blocked = liveDelay !== null && liveDelay > 0;

  const lastSentLabel = snap.lastSendAtMs
    ? `${formatGap(now - snap.lastSendAtMs)} ago`
    : 'no sends yet';

  return (
    <div
      className={`rounded-card p-4 text-xs ring-1 ring-inset ${
        blocked
          ? 'bg-amber-50 text-amber-900 ring-amber-600/25'
          : 'bg-emerald-50 text-emerald-700 ring-emerald-600/20'
      }`}
    >
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span>
          <strong>Rate limiter:</strong>{' '}
          {blocked ? (
            <>
              next send in <span className="font-mono">{formatGap(liveDelay ?? 0)}</span>{' '}
              <span className="opacity-70">({reasonLabel(snap.reason)})</span>
            </>
          ) : (
            <>ready. Next send allowed now</>
          )}
        </span>
        <span className="opacity-70">
          gap {snap.config.minGapMs / 1000}–{snap.config.maxGapMs / 1000}s · batch ≤{snap.config.batchLimit} · {snap.config.maxSendsPerHour}/hr cap
        </span>
        <span className="opacity-70">
          last sent {lastSentLabel} · {snap.sentLastHour} sent in last hour · {snap.inBatch} in current batch
        </span>
      </div>
    </div>
  );
}
