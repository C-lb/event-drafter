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
    <section className="max-w-xl space-y-4">
      <h2 className="text-3xl font-semibold tracking-tight">WhatsApp Web</h2>
      <p className="text-sm text-neutral-700">
        Scan the QR once. The login persists in the local profile directory. See{' '}
        <code>docs/setup/whatsapp.md</code> for the full walkthrough.
      </p>

      <div
        className={`rounded border p-3 text-sm ${
          isLoggedIn
            ? 'border-green-200 bg-green-50 text-green-800'
            : 'border-amber-200 bg-amber-50 text-amber-800'
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
          <pre className="mt-2 overflow-auto rounded bg-red-50 p-2 text-xs text-red-700">{liveError}</pre>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={recheckLive}
          disabled={isPending || scanning}
          className="rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100 disabled:opacity-50"
        >
          {isPending ? 'Probing…' : 'Re-check live'}
        </button>
        <button
          onClick={scan}
          disabled={isPending || scanning}
          className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {scanning ? 'Waiting for QR…' : isLoggedIn ? 'Re-scan QR' : 'Open & scan'}
        </button>
      </div>

      {msg && <p className="rounded bg-neutral-100 p-3 text-sm">{msg}</p>}

      <p className="text-xs text-neutral-500">
        Note: a Chromium window will open briefly during probes and scans, then close. That is
        expected — closing the window releases the profile lock so the worker can use it for sends.
      </p>
    </section>
  );
}
