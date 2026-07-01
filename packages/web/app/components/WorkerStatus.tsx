'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { pillSummary, type WorkerState } from '@/lib/worker-state';
import { engageSafetyStop, releaseSafetyStop } from '@/app/status/safety-actions';
import { startWorker } from '@/app/status/worker-control-actions';
import { waitForWorkerUp } from '@/lib/worker-client';
import { useToast } from '@/app/components/toast/ToastProvider';

const POLL_MS = 4000;

function ago(ms: number | null | undefined): string {
  if (!ms) return '—';
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function uptime(ms: number | null): string {
  if (!ms) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}

const TONE = {
  down: { badge: 'badge-red', dot: 'bg-red-500', pulse: true },
  busy: { badge: 'badge-blue', dot: 'bg-accent', pulse: true },
  idle: { badge: 'badge-green', dot: 'bg-emerald-500', pulse: false },
} as const;

export function WorkerStatus() {
  const [state, setState] = useState<WorkerState | null>(null);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [stopBusy, setStopBusy] = useState(false);
  const [, startStop] = useTransition();
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    let alive = true;
    async function poll() {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const res = await fetch('/api/worker/state', { cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as WorkerState;
        if (alive) {
          setState(data);
          setError(false);
        }
      } catch {
        if (alive) setError(true);
      }
    }
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Close the popover on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // First load / fetch failure: a neutral, honest placeholder.
  if (!state) {
    return (
      <span className="badge badge-neutral">
        <span className="h-1.5 w-1.5 flex-none rounded-full bg-current" />
        {error ? 'worker status unavailable' : 'checking worker…'}
      </span>
    );
  }

  const summary = pillSummary(state);
  const tone = error ? TONE.down : TONE[summary.tone];
  const label = error ? 'worker status unavailable' : summary.text;

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`badge ${tone.badge} cursor-pointer`}
        title="Worker status, click for detail"
      >
        <span className={`h-1.5 w-1.5 flex-none rounded-full ${tone.dot} ${tone.pulse ? 'animate-pulse' : ''}`} />
        {label}
      </button>

      {state.limboCount > 0 && (
        <a
          href="/status"
          className="badge badge-amber ml-2 cursor-pointer"
          title="Messages caught mid-send need your decision"
        >
          {state.limboCount} need a decision
        </a>
      )}

      {state.safetyStopped ? (
        <button
          type="button"
          onClick={() => { setStopBusy(true); startStop(async () => { try { await releaseSafetyStop(); } finally { setStopBusy(false); } }); }}
          disabled={stopBusy}
          className="btn btn-sm ml-2"
        >
          {stopBusy ? <span className="spinner" /> : 'Resume worker'}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => { setStopBusy(true); startStop(async () => { try { await engageSafetyStop(); } finally { setStopBusy(false); } }); }}
          disabled={stopBusy}
          className="btn-danger btn-sm ml-2"
        >
          {stopBusy ? <span className="spinner" /> : 'Safety stop'}
        </button>
      )}

      {open && <Popover state={state} />}

      {mounted && state.safetyStopped &&
        createPortal(<SafetyBanner onResume={() => { setStopBusy(true); startStop(async () => { try { await releaseSafetyStop(); } finally { setStopBusy(false); } }); }} busy={stopBusy} />, getBannerSlot())}

      {mounted &&
        !state.connected &&
        !state.safetyStopped &&
        createPortal(<OfflineBanner state={state} />, getBannerSlot())}
    </div>
  );
}

function getBannerSlot(): HTMLElement {
  let el = document.getElementById('worker-banner-slot');
  if (!el) {
    el = document.createElement('div');
    el.id = 'worker-banner-slot';
    document.body.prepend(el);
  }
  return el;
}

function Popover({ state }: { state: WorkerState }) {
  const { sends, running, queued, lastFinished } = state;
  const byKind = Object.entries(queued.byKind).sort((a, b) => b[1] - a[1]);
  const beatAt = state.beatAgeMs != null ? Date.now() - state.beatAgeMs : null;
  return (
    <div className="absolute right-0 top-full z-40 mt-2 w-80 rounded-card border border-line bg-surface p-4 text-xs shadow-soft">
      <div className="flex items-center justify-between">
        <span className="eyebrow">Worker</span>
        <span className="text-ink-3">
          {state.connected ? `up ${uptime(state.uptimeMs)}` : `offline, last beat ${ago(beatAt)}`}
        </span>
      </div>

      {/* Doing now */}
      <div className="mt-3">
        <p className="eyebrow mb-1 text-ink-3">Doing now</p>
        {sends.current ? (
          <p className="text-ink">Sending to <strong>{sends.current.name}</strong></p>
        ) : null}
        {running.length === 0 && !sends.current ? (
          <p className="text-ink-3">Idle, nothing running.</p>
        ) : (
          <ul className="space-y-0.5">
            {running.map((j) => (
              <li key={j.id} className="flex justify-between gap-2">
                <span className="font-mono text-ink-2">{j.kind} #{j.id}</span>
                <span className="text-ink-3">{j.progress ?? ''}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Sends: who / who's next */}
      {(sends.recent.length > 0 || sends.next || sends.queuedCount > 0) && (
        <div className="mt-3 border-t border-line pt-3">
          <p className="eyebrow mb-1 text-ink-3">Messaging</p>
          {sends.recent.length > 0 && (
            <p className="text-ink-2">
              Sent to: <span className="text-ink">{sends.recent.map((r) => r.name).join(', ')}</span>
            </p>
          )}
          {sends.next && (
            <p className="text-ink-2">
              Next up: <strong className="text-ink">{sends.next.name}</strong>
            </p>
          )}
          {sends.queuedCount > 0 && (
            <p className="text-ink-3">{sends.queuedCount} still to send</p>
          )}
        </div>
      )}

      {/* Backlog */}
      <div className="mt-3 border-t border-line pt-3">
        <p className="eyebrow mb-1 text-ink-3">Backlog</p>
        {queued.total === 0 ? (
          <p className="text-ink-3">Queue empty.</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {byKind.map(([kind, n]) => (
              <span key={kind} className="badge badge-neutral">
                {kind} · {n}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Last done */}
      <div className="mt-3 border-t border-line pt-3">
        <p className="eyebrow mb-1 text-ink-3">Last finished</p>
        {lastFinished ? (
          <p className="text-ink-2">
            <span className="font-mono">{lastFinished.kind} #{lastFinished.id}</span>{' '}
            <span className={lastFinished.status === 'failed' ? 'text-red-600' : 'text-emerald-600'}>{lastFinished.status}</span>{' '}
            <span className="text-ink-3">{ago(lastFinished.finishedAt)}</span>
          </p>
        ) : (
          <p className="text-ink-3">No jobs yet.</p>
        )}
      </div>

      <a href="/status" className="btn btn-sm mt-3 w-full">Open full status</a>
    </div>
  );
}

function SafetyBanner({ onResume, busy }: { onResume: () => void; busy: boolean }) {
  return (
    <div className="border-b border-red-600/25 bg-red-50 text-red-800">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-6 py-2.5 text-sm">
        <span className="inline-flex items-center gap-2 font-semibold text-red-900">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 flex-none" aria-hidden>
            <circle cx="12" cy="12" r="9" /><path d="M9 9h6v6H9z" />
          </svg>
          Safety stop engaged
        </span>
        <span className="text-red-700">The worker is halted. No messages will be sent until you resume.</span>
        <button type="button" onClick={onResume} disabled={busy} className="btn btn-sm ml-auto border-red-600/30 bg-white/70">
          {busy ? <span className="spinner" /> : 'Resume worker'}
        </button>
      </div>
    </div>
  );
}

function OfflineBanner({ state }: { state: WorkerState }) {
  const interrupted =
    state.sends.current?.name
      ? `was sending to ${state.sends.current.name}`
      : state.running.length > 0
        ? `interrupted: ${state.running.map((j) => `${j.kind} #${j.id}`).join(', ')}`
        : 'no task was in flight';
  return (
    <div className="border-b border-amber-600/25 bg-amber-50 text-amber-900">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-6 py-2.5 text-sm">
        <span className="inline-flex items-center gap-2 font-semibold">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 flex-none" aria-hidden>
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <path d="M12 9v4M12 17h.01" />
          </svg>
          Worker offline
        </span>
        <span className="text-amber-800">
          last beat {ago(Date.now() - (state.beatAgeMs ?? 0))} · {interrupted}
          {state.queued.total > 0 ? ` · ${state.queued.total} job${state.queued.total > 1 ? 's' : ''} waiting` : ' · nothing queued'}
          {state.sends.next ? `, next up ${state.sends.next.name}` : ''}
        </span>
        {state.limboCount > 0 && (
          <span className="font-semibold text-amber-900"> · {state.limboCount} need a decision</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <StartWorkerButton />
          <a href="/status" className="btn btn-sm border-amber-600/30 bg-white/60">
            Open status
          </a>
        </div>
      </div>
    </div>
  );
}

function StartWorkerButton() {
  const { show, update } = useToast();
  const [busy, start] = useTransition();

  const onClick = () => {
    start(async () => {
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
        if (up) {
          update(id, { tone: 'success', title: 'Worker is online', meta: 'running', body: 'The worker is up and processing jobs.', sparkle: true, duration: 6000, dismissible: true });
        } else {
          update(id, { tone: 'warning', title: 'Worker not confirmed', body: 'It was launched but has not reported back yet.', duration: null, dismissible: true });
        }
      } catch (err) {
        update(id, { tone: 'error', title: 'Could not start worker', body: err instanceof Error ? err.message : 'Unknown error', duration: null, dismissible: true });
      }
    });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="btn-primary btn-sm disabled:cursor-not-allowed disabled:opacity-60"
      title="Launch the background worker. No terminal needed."
    >
      {busy ? 'Starting…' : 'Start worker'}
    </button>
  );
}
