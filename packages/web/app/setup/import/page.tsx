'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { enqueueImport, importStatus, completeSetup } from './actions';

export default function ImportPage() {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof importStatus>> | null>(null);
  const [isPending, start] = useTransition();

  const refresh = () => {
    start(async () => setStatus(await importStatus()));
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 1500);
    return () => clearInterval(t);
  }, []);

  const run = () => start(async () => { await enqueueImport(); refresh(); });
  const finish = () => start(async () => { await completeSetup(); refresh(); });

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
      <div className="flex flex-wrap gap-2">
        <button onClick={run} disabled={isPending} className="btn-primary disabled:opacity-50">Run import</button>
        <button onClick={finish} disabled={isPending || (status?.contactCount ?? 0) === 0} className="btn-primary bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50">
          Mark setup complete
        </button>
        <Link href="/" className="btn">Back to dashboard</Link>
      </div>
    </section>
  );
}
