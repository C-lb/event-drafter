'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useFormStatus } from 'react-dom';

export type ResyncJobView =
  | { status: 'queued' | 'running' | 'succeeded' | 'failed'; finishedAtMs: number | null }
  | null;

interface Props {
  action: () => Promise<void>;
  job: ResyncJobView;
}

function Spinner() {
  return (
    <svg
      className="h-3 w-3 animate-spin text-current"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path
        d="M4 12a8 8 0 0 1 8-8"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SubmitButton({ syncing }: { syncing: boolean }) {
  const { pending } = useFormStatus();
  const busy = pending || syncing;
  const label = pending ? 'Queuing…' : syncing ? 'Syncing…' : 'Re-sync from Sheet';
  return (
    <button
      type="submit"
      disabled={busy}
      aria-busy={busy}
      className="btn btn-sm inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {busy && <Spinner />}
      <span>{label}</span>
    </button>
  );
}

export function ResyncButton({ action, job }: Props) {
  const router = useRouter();
  const active = job?.status === 'queued' || job?.status === 'running';

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), 1500);
    return () => clearInterval(id);
  }, [active, router]);

  return (
    <form action={action} className="flex items-center gap-2">
      <SubmitButton syncing={active} />
      {job?.status === 'running' && (
        <span className="inline-flex items-center gap-1 text-xs text-ink-2">
          <Spinner />
          syncing rows…
        </span>
      )}
      {job?.status === 'queued' && (
        <span className="text-xs text-ink-3">queued for worker…</span>
      )}
      {job?.status === 'failed' && (
        <span className="text-xs text-red-700">last sync failed, try again</span>
      )}
    </form>
  );
}
