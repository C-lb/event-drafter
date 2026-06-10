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
    <section className="max-w-xl space-y-4">
      <h2 className="text-xl font-semibold">Step 4 — Import contacts</h2>
      <p className="text-sm text-neutral-700">
        Clicking import enqueues a job for the worker. Pull happens in the background; this page polls for status.
      </p>
      <div className="rounded border border-neutral-200 bg-white p-3 text-sm">
        <p>Contacts in DB: <strong>{status?.contactCount ?? '…'}</strong></p>
        <p>Last import job: <strong>{status?.job?.status ?? 'none'}</strong></p>
        {status?.job?.last_error && (
          <pre className="mt-2 overflow-auto rounded bg-red-50 p-2 text-xs text-red-700">{status.job.last_error}</pre>
        )}
      </div>
      <div className="flex gap-2">
        <button onClick={run} disabled={isPending} className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Run import</button>
        <button onClick={finish} disabled={isPending || (status?.contactCount ?? 0) === 0} className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          Mark setup complete
        </button>
        <Link href="/" className="rounded border border-neutral-300 px-4 py-2 text-sm">Back to dashboard</Link>
      </div>
    </section>
  );
}
