'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { enqueueImport, importStatus, completeSetup } from './actions';

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-[1.05em] w-[1.05em] flex-none" aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export default function ImportPage() {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof importStatus>> | null>(null);
  const [isPending, start] = useTransition();
  const [importDone, setImportDone] = useState(false);
  const [setupDone, setSetupDone] = useState(false);
  const prevJobStatus = useRef<string | null>(null);

  const refresh = () => {
    start(async () => {
      const next = await importStatus();
      // The job runs in the background (polled, not awaited), so the
      // completion signal has to come from watching its status flip.
      if (prevJobStatus.current && prevJobStatus.current !== 'succeeded' && next.job?.status === 'succeeded') {
        setImportDone(true);
        setTimeout(() => setImportDone(false), 3000);
      }
      prevJobStatus.current = next.job?.status ?? null;
      setStatus(next);
    });
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 1500);
    return () => clearInterval(t);
  }, []);

  const run = () => start(async () => { await enqueueImport(); refresh(); });
  const finish = () => start(async () => {
    await completeSetup();
    setSetupDone(true);
    setTimeout(() => setSetupDone(false), 3000);
    refresh();
  });

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <p className="eyebrow">Step 4</p>
        <h2 className="text-2xl font-semibold tracking-tight">Import contacts</h2>
      </div>
      <p className="text-sm text-ink-2">
        Clicking import enqueues a job for the worker. Pull happens in the background and this page polls for status.
      </p>
      <div className="card p-5 text-sm text-ink-2">
        <p>Contacts in DB: <strong>{status?.contactCount ?? '…'}</strong></p>
        <p>Last import job: <strong>{status?.job?.status ?? 'none'}</strong></p>
        {status?.job?.last_error && (
          <pre className="mt-2 overflow-auto rounded-card bg-red-50 p-4 text-xs text-red-700 ring-1 ring-inset ring-red-600/20">{status.job.last_error}</pre>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={run} disabled={isPending} className="btn-primary disabled:opacity-50">Run import</button>
        <button onClick={finish} disabled={isPending || (status?.contactCount ?? 0) === 0} className="btn-primary bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50">
          Mark setup complete
        </button>
        <Link href="/" className="btn">Back to dashboard</Link>
      </div>
      {(importDone || setupDone) && (
        <p role="status" className="flex items-center gap-2 text-sm font-medium text-emerald-700">
          <CheckIcon />
          {setupDone ? 'Setup complete.' : `Import finished. ${status?.contactCount ?? 0} contacts in DB.`}
        </p>
      )}
    </section>
  );
}
