'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-[1.05em] w-[1.05em] flex-none" aria-hidden>
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-[1.05em] w-[1.05em] flex-none" aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

type Phase = 'idle' | 'busy' | 'done';

/**
 * Icon button that runs a server action, shows a spinner while it's in flight,
 * then a brief check before reverting. `label` is optional (icon-only when omitted).
 */
export function RefreshButton({
  action,
  title,
  label,
}: {
  action: () => Promise<void>;
  title: string;
  label?: string;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('idle');

  const run = async () => {
    if (phase === 'busy') return;
    setPhase('busy');
    try {
      await action();
      router.refresh();
      setPhase('done');
      setTimeout(() => setPhase('idle'), 1200);
    } catch {
      setPhase('idle');
    }
  };

  return (
    <button
      type="button"
      onClick={run}
      disabled={phase === 'busy'}
      title={title}
      aria-label={title}
      className={`btn btn-sm ${label ? '' : 'px-2'} ${phase === 'busy' ? 'is-loading' : ''}`}
    >
      {phase === 'busy' ? <span className="spinner" aria-hidden /> : phase === 'done' ? <CheckIcon /> : <RefreshIcon />}
      {label && <span>{phase === 'busy' ? 'Refreshing…' : phase === 'done' ? 'Done' : label}</span>}
    </button>
  );
}
