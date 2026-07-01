'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { RestartResult } from './actions';
import { useToast } from '../components/toast/ToastProvider';

function Spinner() {
  return (
    <svg className="h-3 w-3 animate-spin text-current" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path d="M4 12a8 8 0 0 1 8-8" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

function summarize(r: RestartResult): string {
  const parts: string[] = [];
  if (r.drafted) parts.push(`${r.drafted} draft${r.drafted === 1 ? '' : 's'} queued`);
  if (r.requeued) parts.push(`${r.requeued} retried`);
  if (r.orphansPurged) parts.push(`${r.orphansPurged} orphan${r.orphansPurged === 1 ? '' : 's'} purged`);
  if (r.rechecked) parts.push('rechecking replies');
  if (r.followUps) parts.push('follow-ups');
  return parts.length ? `Re-queued: ${parts.join(', ')}.` : 'Nothing was pending to re-queue.';
}

async function workerConnected(): Promise<boolean> {
  try {
    const r = await fetch('/api/worker/state', { cache: 'no-store' });
    if (!r.ok) return false;
    const d = await r.json();
    return d.connected === true;
  } catch {
    return false;
  }
}

/** Poll the worker heartbeat until it reports connected, or the deadline passes. */
async function waitForWorker(timeoutMs: number): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await workerConnected()) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

export function RestartWorkerButton({
  action,
  workerOk,
}: {
  action: () => Promise<RestartResult>;
  workerOk: boolean;
}) {
  const router = useRouter();
  const { show, update } = useToast();
  const [running, setRunning] = useState(false);

  const run = async () => {
    if (running) return;
    if (!confirm('Restart the worker and re-check everything? This re-queues drafts, replies and follow-ups.')) return;
    setRunning(true);

    const id = show({
      tone: 'loading',
      title: 'Restarting worker',
      meta: 'please wait',
      body: 'Re-queuing drafts, replies and follow-ups, and signaling a restart.',
      duration: null,
      dismissible: false,
    });

    try {
      const res = await action();
      router.refresh();
      update(id, {
        tone: 'loading',
        title: 'Restart signaled',
        meta: 'checking',
        body: 'Waiting for the worker to report back online.',
      });

      const back = await waitForWorker(12000);
      if (back) {
        update(id, {
          tone: 'success',
          title: 'Worker restarted',
          meta: 'online',
          body: summarize(res),
          sparkle: true,
          duration: 7000,
          dismissible: true,
          actions: [{ label: 'View status', href: '/status', variant: 'ghost' }],
        });
      } else {
        update(id, {
          tone: 'warning',
          title: 'Worker not detected',
          meta: 'offline',
          body: `${summarize(res)} The worker did not report back. If it is not running, start it from a terminal.`,
          duration: null,
          dismissible: true,
        });
      }
    } catch (err) {
      update(id, {
        tone: 'error',
        title: 'Restart failed',
        body: err instanceof Error ? err.message : 'Something went wrong signaling the restart.',
        duration: null,
        dismissible: true,
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={run}
        disabled={running}
        aria-busy={running}
        className="btn-primary btn-sm inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
        title="Re-queue drafts, replies and follow-ups, and signal the worker to restart"
      >
        {running && <Spinner />}
        <span>{running ? 'Restarting…' : 'Restart worker & recheck'}</span>
      </button>
      {!workerOk && !running && (
        <span className="max-w-xs text-right text-xs text-amber-700">
          Worker looks down. Jobs will queue but won&apos;t run until you start it from a terminal.
        </span>
      )}
    </div>
  );
}
