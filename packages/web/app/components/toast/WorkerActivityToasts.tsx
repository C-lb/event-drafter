'use client';

import { useEffect, useRef } from 'react';
import { useToast } from './ToastProvider';
import { describeWorkerEvent, type WorkerEvent } from '@/lib/worker-events';

const POLL_MS = 3000;

interface EventsResponse {
  events: WorkerEvent[];
  cursor: number;
}

/**
 * Watches the worker's event feed and raises a toast for every job the worker
 * starts and every job it finishes. Mounted once, near the ToastProvider.
 *
 * The cursor seeds to mount time so opening the app never replays old jobs;
 * each event is toasted at most once (deduped by its stable key).
 */
export function WorkerActivityToasts() {
  const { show } = useToast();
  const sinceRef = useRef<number>(Date.now());
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;

    async function poll() {
      try {
        const res = await fetch(`/api/worker/events?since=${sinceRef.current}`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = (await res.json()) as EventsResponse;
        if (!alive) return;

        for (const ev of data.events) {
          if (seen.current.has(ev.key)) continue;
          seen.current.add(ev.key);
          const t = describeWorkerEvent(ev);
          show({ tone: t.tone, title: t.title, meta: t.meta, body: t.body, duration: t.duration });
        }
        // Advance the cursor, never rewind it.
        if (typeof data.cursor === 'number') {
          sinceRef.current = Math.max(sinceRef.current, data.cursor);
        }
      } catch {
        // Transient fetch failure: stay quiet, next tick retries.
      }
    }

    poll();
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      poll();
    }, POLL_MS);
    function onVisible() {
      if (typeof document !== 'undefined' && !document.hidden) poll();
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [show]);

  return null;
}
