'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { RestartResult } from './actions';

function Spinner() {
  return (
    <svg className="h-3 w-3 animate-spin text-current" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path d="M4 12a8 8 0 0 1 8-8" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

type Phase = 'idle' | 'running' | 'done' | 'error';

function summarize(r: RestartResult): string {
  const parts: string[] = [];
  if (r.drafted) parts.push(`${r.drafted} draft${r.drafted === 1 ? '' : 's'} queued`);
  if (r.requeued) parts.push(`${r.requeued} retried`);
  if (r.orphansPurged) parts.push(`${r.orphansPurged} orphan${r.orphansPurged === 1 ? '' : 's'} purged`);
  if (r.rechecked) parts.push('rechecking replies');
  if (r.followUps) parts.push('follow-ups');
  return parts.length ? `Restarted: ${parts.join(', ')}.` : 'Restarted. Nothing was pending.';
}

export function RestartWorkerButton({
  action,
  workerOk,
}: {
  action: () => Promise<RestartResult>;
  workerOk: boolean;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('idle');
  const [msg, setMsg] = useState<string | null>(null);

  const run = async () => {
    if (phase === 'running') return;
    if (!confirm('Restart the worker and re-check everything? This re-queues drafts, replies and follow-ups.')) return;
    setPhase('running');
    setMsg(null);
    try {
      const res = await action();
      setMsg(summarize(res));
      setPhase('done');
      router.refresh();
      setTimeout(() => setPhase('idle'), 6000);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Restart failed');
      setPhase('error');
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={run}
        disabled={phase === 'running'}
        aria-busy={phase === 'running'}
        className="btn-primary btn-sm inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
        title="Re-queue drafts, replies and follow-ups, and signal the worker to restart"
      >
        {phase === 'running' && <Spinner />}
        <span>{phase === 'running' ? 'Restarting…' : 'Restart worker & recheck'}</span>
      </button>
      {!workerOk && phase !== 'running' && (
        <span className="max-w-xs text-right text-xs text-amber-700">
          Worker looks down. Jobs will queue but won&apos;t run until you start it from a terminal.
        </span>
      )}
      {msg && (
        <span className={`max-w-xs text-right text-xs ${phase === 'error' ? 'text-red-700' : 'text-ink-2'}`}>
          {msg}
        </span>
      )}
    </div>
  );
}
