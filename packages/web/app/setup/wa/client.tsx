'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

type LiveState = 'logged-in' | 'needs-qr' | 'unknown' | 'error';

interface Props {
  initialReady: boolean;
}

export function WaSetupClient({ initialReady }: Props) {
  const router = useRouter();
  const [liveState, setLiveState] = useState<LiveState | null>(initialReady ? 'logged-in' : null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [isPending, start] = useTransition();
  const [scanning, setScanning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const recheckLive = () =>
    start(async () => {
      setMsg('Probing Chromium…');
      setLiveError(null);
      const r = await fetch('/api/wa/state?live=1').then((r) => r.json());
      setLiveState(r.state);
      setLiveError(r.error ?? null);
      setMsg(null);
      router.refresh();
    });

  const scan = async () => {
    setScanning(true);
    setMsg('Opening Chromium. Scan the QR with your phone (up to 5 minutes)…');
    setLiveError(null);
    try {
      const r = await fetch('/api/wa/scan', { method: 'POST' });
      const j = await r.json();
      if (j.ok) {
        setLiveState('logged-in');
        setMsg('Signed in.');
        router.refresh();
      } else {
        setLiveState('error');
        setLiveError(j.error ?? 'Unknown error');
        setMsg(null);
      }
    } finally {
      setScanning(false);
    }
  };

  const display = liveState ?? (initialReady ? 'logged-in' : 'unknown');
  const isLoggedIn = display === 'logged-in';

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <p className="eyebrow">Step 5</p>
        <h2 className="text-2xl font-semibold tracking-tight">Connect WhatsApp Web</h2>
      </div>
      <p className="text-sm text-ink-2">
        Scan the QR once. The login persists in the local profile directory. See{' '}
        <code>docs/setup/whatsapp.md</code> for the full walkthrough.
      </p>

      <div
        className={`rounded-card p-4 text-sm ring-1 ring-inset ${
          isLoggedIn
            ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20'
            : 'bg-amber-50 text-amber-900 ring-amber-600/25'
        }`}
      >
        Status: <strong>{display}</strong>
        {!liveState && (
          <p className="mt-1 text-xs opacity-80">
            {initialReady
              ? 'Last successful login recorded. Click "Re-check live" if you suspect the session was lost.'
              : 'No record of a successful login. Click "Open & scan" to connect.'}
          </p>
        )}
        {liveError && (
          <pre className="mt-2 overflow-auto rounded-card bg-red-50 p-4 text-xs text-red-700 ring-1 ring-inset ring-red-600/20">{liveError}</pre>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={recheckLive}
          disabled={isPending || scanning}
          className="btn disabled:opacity-50"
        >
          {isPending ? 'Probing…' : 'Re-check live'}
        </button>
        <button
          onClick={scan}
          disabled={isPending || scanning}
          className="btn-primary disabled:opacity-50"
        >
          {scanning ? 'Waiting for QR…' : isLoggedIn ? 'Re-scan QR' : 'Open & scan'}
        </button>
      </div>

      {msg && <p className="rounded-card bg-accent-soft p-4 text-sm text-accent ring-1 ring-inset ring-accent-line">{msg}</p>}

      <p className="text-xs text-ink-3">
        Note: a Chromium window will open briefly during probes and scans, then close. That is
        expected. Closing the window releases the profile lock so the worker can use it for sends.
      </p>
    </section>
  );
}
