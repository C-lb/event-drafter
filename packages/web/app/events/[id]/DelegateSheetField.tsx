'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { setDelegateSheet } from './actions';

type Phase = 'idle' | 'saving' | 'saved' | 'error';

export function DelegateSheetField({ eventId, initialUrl }: { eventId: number; initialUrl: string | null }) {
  const router = useRouter();
  const [url, setUrl] = useState(initialUrl ?? '');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setPhase('saving');
    setError(null);
    const res = await setDelegateSheet({ event_id: eventId, url });
    if (!res.ok) {
      setError(res.error);
      setPhase('error');
      return;
    }
    setUrl(res.url ?? '');
    setPhase('saved');
    router.refresh();
    setTimeout(() => setPhase('idle'), 2000);
  };

  return (
    <div className="card p-5 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-ink">Delegate tracker sheet</h3>
        {initialUrl && (
          <a href={initialUrl} target="_blank" rel="noreferrer" className="text-xs font-medium text-accent hover:text-accent-hover">
            Open sheet ↗
          </a>
        )}
      </div>
      <p className="text-xs text-ink-2">
        Paste this event&apos;s Google Sheet link. When you approve a <strong>yes</strong>, that delegate&apos;s
        row shifts up into the confirmed block. Matched by mobile number.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="field flex-1 min-w-[16rem]"
          placeholder="https://docs.google.com/spreadsheets/d/…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
          aria-label="Delegate tracker sheet link"
        />
        <button
          type="button"
          onClick={save}
          disabled={phase === 'saving' || url.trim() === (initialUrl ?? '')}
          className="btn btn-sm disabled:cursor-not-allowed disabled:opacity-60"
        >
          {phase === 'saving' ? 'Saving…' : phase === 'saved' ? 'Saved ✓' : 'Save'}
        </button>
      </div>
      {error && <p className="text-xs text-red-700">{error}</p>}
      <p className="text-[11px] text-ink-3">
        Needs Google to be re-authorized for write access (Status page → Re-authorize) the first time.
      </p>
    </div>
  );
}
