'use client';

import { useEffect, useState, useTransition } from 'react';

interface StateResponse { state: 'logged-in' | 'needs-qr' | 'unknown' | 'error'; error?: string; }

export default function WaSetupPage() {
  const [state, setState] = useState<StateResponse | null>(null);
  const [isPending, start] = useTransition();
  const [scanning, setScanning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const check = () => start(async () => {
    setMsg(null);
    const r = await fetch('/api/wa/state').then((r) => r.json());
    setState(r);
  });

  useEffect(() => { check(); }, []);

  const scan = async () => {
    setScanning(true);
    setMsg('Opening Chromium and waiting for QR scan (up to 5 minutes)…');
    try {
      const r = await fetch('/api/wa/scan', { method: 'POST' });
      const j = await r.json();
      if (j.ok) {
        setMsg('✓ Signed in.');
        check();
      } else {
        setMsg('Error: ' + j.error);
      }
    } finally {
      setScanning(false);
    }
  };

  return (
    <section className="max-w-xl space-y-4">
      <h2 className="text-xl font-semibold">WhatsApp Web</h2>
      <p className="text-sm text-neutral-700">
        See <code>docs/setup/whatsapp.md</code> for the full walkthrough.
      </p>
      <div className="rounded border border-neutral-200 bg-white p-3 text-sm">
        Status: <strong>{state?.state ?? '…'}</strong>
        {state?.error && <pre className="mt-2 overflow-auto rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</pre>}
      </div>
      <div className="flex gap-2">
        <button onClick={check} disabled={isPending || scanning} className="rounded border border-neutral-300 px-3 py-1 text-sm">
          Re-check
        </button>
        <button
          onClick={scan}
          disabled={isPending || scanning || state?.state === 'logged-in'}
          className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
        >
          {scanning ? 'Waiting for QR…' : 'Open & scan'}
        </button>
      </div>
      {msg && <p className="rounded bg-neutral-100 p-3 text-sm">{msg}</p>}
    </section>
  );
}
