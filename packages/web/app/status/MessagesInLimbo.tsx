// packages/web/app/status/MessagesInLimbo.tsx
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { LimboRecord } from '@/lib/limbo';
import { recoverMarkSent, recoverResend, recoverResendAllPrefilled } from './limbo-actions';

export function MessagesInLimbo({ records, prefilledCount }: { records: LimboRecord[]; prefilledCount: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();

  if (records.length === 0) return null;

  const run = (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    start(async () => {
      try {
        await fn();
        router.refresh();
      } finally {
        setBusy(null);
      }
    });
  };

  return (
    <div className="card border-amber-600/25 bg-amber-50 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-amber-900">Messages in limbo</h3>
          <p className="text-xs text-amber-800">
            The worker was cut off mid-send on these. They will not resend on their own. Choose what happened.
          </p>
        </div>
        {prefilledCount > 0 && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => run('bulk', () => recoverResendAllPrefilled())}
            className={`btn btn-sm ${busy === 'bulk' ? 'is-loading' : ''}`}
          >
            {busy === 'bulk' ? <span className="spinner" /> : `Resend all prefilled (${prefilledCount})`}
          </button>
        )}
      </div>

      <ul className="mt-3 space-y-2">
        {records.map((r) => {
          const key = `${r.type}:${r.id}`;
          return (
            <li key={key} className="flex flex-wrap items-center justify-between gap-2 rounded-sm bg-white/60 px-3 py-2 text-sm">
              <span className="flex items-center gap-2">
                <span className={`badge ${r.state === 'sending' ? 'badge-amber' : 'badge-neutral'}`}>
                  {r.state === 'sending' ? 'mid-send' : 'prefilled'}
                </span>
                <strong className="text-ink">{r.name.trim()}</strong>
                {r.eventName && <span className="text-ink-3">{r.eventName}</span>}
              </span>
              <span className="flex gap-2">
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => run(`sent:${key}`, () => recoverMarkSent({ type: r.type, id: r.id }))}
                  className={`btn btn-sm ${busy === `sent:${key}` ? 'is-loading' : ''}`}
                >
                  {busy === `sent:${key}` ? <span className="spinner" /> : 'It was sent'}
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => run(`resend:${key}`, () => recoverResend({ type: r.type, id: r.id }))}
                  className={`btn-primary btn-sm ${busy === `resend:${key}` ? 'is-loading' : ''}`}
                >
                  {busy === `resend:${key}` ? <span className="spinner" /> : 'Resend'}
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
