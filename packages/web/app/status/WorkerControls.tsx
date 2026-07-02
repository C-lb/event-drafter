'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { RestartResult } from './actions';
import { startWorker, stopWorker } from './worker-control-actions';
import { waitForWorkerUp, waitForWorkerDown } from '@/lib/worker-client';
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

export function WorkerControls({
  restartAction,
  workerOk,
}: {
  restartAction: () => Promise<RestartResult>;
  workerOk: boolean;
}) {
  const router = useRouter();
  const { show, update } = useToast();
  const [busy, setBusy] = useState<null | 'start' | 'stop' | 'restart'>(null);

  const start = async () => {
    if (busy) return;
    setBusy('start');
    const id = show({
      tone: 'loading',
      title: 'Starting worker',
      meta: 'please wait',
      body: 'Launching the background worker.',
      duration: null,
      dismissible: false,
    });
    try {
      const res = await startWorker();
      if (!res.ok) {
        update(id, { tone: 'error', title: 'Could not start worker', body: res.message ?? 'Spawn failed.', duration: null, dismissible: true });
        return;
      }
      update(id, { tone: 'loading', title: 'Worker launched', meta: 'checking', body: 'Waiting for it to report online.', dismissible: false });
      const up = await waitForWorkerUp(20000);
      router.refresh();
      if (up) {
        update(id, {
          tone: 'success',
          title: 'Worker is online',
          meta: 'running',
          body: 'The worker is up and processing jobs. No terminal needed.',
          sparkle: true,
          duration: 6000,
          dismissible: true,
        });
      } else {
        update(id, {
          tone: 'warning',
          title: 'Worker not confirmed',
          meta: 'no heartbeat',
          body: 'It was launched but has not reported back yet. Check the status page in a moment.',
          duration: null,
          dismissible: true,
        });
      }
    } catch (err) {
      update(id, { tone: 'error', title: 'Could not start worker', body: err instanceof Error ? err.message : 'Unknown error', duration: null, dismissible: true });
    } finally {
      setBusy(null);
    }
  };

  const stop = async () => {
    if (busy) return;
    if (!confirm('Stop the worker? Jobs will queue but nothing will send until you start it again.')) return;
    setBusy('stop');
    const id = show({
      tone: 'loading',
      title: 'Stopping worker',
      meta: 'please wait',
      body: 'Signaling the worker to shut down.',
      duration: null,
      dismissible: false,
    });
    try {
      const res = await stopWorker();
      if (!res.ok) {
        update(id, { tone: 'error', title: 'Could not stop worker', body: res.message ?? 'Failed to stop.', duration: null, dismissible: true });
        return;
      }
      const down = await waitForWorkerDown(10000);
      router.refresh();
      update(id, {
        tone: down ? 'success' : 'warning',
        title: down ? 'Worker stopped' : 'Stop signaled',
        meta: down ? 'offline' : 'still winding down',
        body: down
          ? 'The worker is stopped. Auto-start is off until you start it again.'
          : 'Sent the stop signal; it may take a moment to finish its current task.',
        duration: down ? 6000 : null,
        dismissible: true,
      });
    } catch (err) {
      update(id, { tone: 'error', title: 'Could not stop worker', body: err instanceof Error ? err.message : 'Unknown error', duration: null, dismissible: true });
    } finally {
      setBusy(null);
    }
  };

  const restart = async () => {
    if (busy) return;
    if (!confirm('Restart the worker and re-check everything? This re-queues drafts, replies and follow-ups.')) return;
    setBusy('restart');
    const id = show({
      tone: 'loading',
      title: 'Restarting worker',
      meta: 'please wait',
      body: 'Re-queuing drafts, replies and follow-ups, and signaling a restart.',
      duration: null,
      dismissible: false,
    });
    try {
      const res = await restartAction();
      router.refresh();
      update(id, { tone: 'loading', title: 'Restart signaled', meta: 'checking', body: 'Waiting for the worker to report back online.', dismissible: false });
      const up = await waitForWorkerUp(12000);
      if (up) {
        update(id, {
          tone: 'success',
          title: 'Worker restarted',
          meta: 'online',
          body: summarize(res),
          sparkle: true,
          duration: 7000,
          dismissible: true,
        });
      } else {
        update(id, {
          tone: 'warning',
          title: 'Worker not detected',
          meta: 'offline',
          body: `${summarize(res)} The worker did not report back. Use Start worker to launch it.`,
          duration: null,
          dismissible: true,
        });
      }
    } catch (err) {
      update(id, { tone: 'error', title: 'Restart failed', body: err instanceof Error ? err.message : 'Something went wrong.', duration: null, dismissible: true });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {!workerOk && (
          <button
            type="button"
            onClick={start}
            disabled={busy !== null}
            aria-busy={busy === 'start'}
            className="btn-primary btn-sm inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
            title="Launch the background worker. No terminal needed."
          >
            {busy === 'start' && <Spinner />}
            <span>{busy === 'start' ? 'Starting…' : 'Start worker'}</span>
          </button>
        )}
        {workerOk && (
          <>
            <button
              type="button"
              onClick={restart}
              disabled={busy !== null}
              aria-busy={busy === 'restart'}
              className="btn-primary btn-sm inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
              title="Re-queue drafts, replies and follow-ups, and signal the worker to restart"
            >
              {busy === 'restart' && <Spinner />}
              <span>{busy === 'restart' ? 'Restarting…' : 'Restart worker & recheck'}</span>
            </button>
            <button
              type="button"
              onClick={stop}
              disabled={busy !== null}
              aria-busy={busy === 'stop'}
              className="btn btn-sm inline-flex items-center gap-2 text-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              title="Stop the background worker. Auto-start stays off until you start it again."
            >
              {busy === 'stop' && <Spinner />}
              <span>{busy === 'stop' ? 'Stopping…' : 'Stop worker'}</span>
            </button>
          </>
        )}
      </div>
      {!workerOk && busy === null && (
        <span className="max-w-xs text-right text-xs text-amber-700">
          Worker is offline. Click Start worker to launch it, no terminal needed.
        </span>
      )}
    </div>
  );
}
