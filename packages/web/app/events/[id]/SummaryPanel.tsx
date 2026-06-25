'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { regenerateEventSummary, updateEvent } from '../actions';

interface Props {
  event: {
    id: number;
    name: string;
    event_date: Date | string;
    venue: string | null;
    edm_subject: string | null;
    edm_body: string | null;
    edm_summary: string | null;
  };
}

export function SummaryPanel({ event }: Props) {
  const router = useRouter();
  const [isPending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(event.edm_summary ?? '');
  const [banner, setBanner] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const regenerate = () => {
    setBanner(null);
    start(async () => {
      const r = await regenerateEventSummary(event.id);
      if (!r.ok) { setBanner({ kind: 'err', text: r.error }); return; }
      setDraft(r.summary);
      setBanner({ kind: 'ok', text: 'Regenerated from EDM body.' });
      router.refresh();
    });
  };

  const save = () => {
    setBanner(null);
    start(async () => {
      const r = await updateEvent({
        id: event.id,
        name: event.name,
        event_date: new Date(event.event_date).toISOString(),
        venue: event.venue ?? '',
        edm_subject: event.edm_subject ?? '',
        edm_body: event.edm_body ?? '',
        edm_summary: draft,
      });
      if (!r.ok) { setBanner({ kind: 'err', text: r.error }); return; }
      setBanner({ kind: 'ok', text: 'Saved.' });
      setEditing(false);
      router.refresh();
    });
  };

  const summaryText = event.edm_summary ?? '';
  const hasSummary = summaryText.trim().length > 0;

  return (
    <div className="card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-ink">EDM summary</h3>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={regenerate}
            disabled={isPending}
            className="btn btn-sm disabled:opacity-50"
          >
            {isPending ? 'Working…' : 'Regenerate from EDM body'}
          </button>
          <button
            type="button"
            onClick={() => { setEditing((v) => !v); if (!editing) setDraft(summaryText); }}
            className="btn btn-sm"
          >
            {editing ? 'Cancel' : 'Edit'}
          </button>
        </div>
      </div>

      <p className="text-xs text-ink-3">
        Structured facts extracted from the EDM (date, time, venue, dress code, highlights, speakers,
        registration link). Used by the LLM when drafting personalised invitations and as the input
        for the starter-draft cards below.
      </p>

      {banner && (
        <div className={banner.kind === 'ok'
          ? 'rounded-card bg-emerald-50 p-4 text-sm text-emerald-700 ring-1 ring-inset ring-emerald-600/20'
          : 'rounded-card bg-red-50 p-4 text-sm text-red-700 ring-1 ring-inset ring-red-600/20'}>
          {banner.text}
        </div>
      )}

      {!editing ? (
        hasSummary ? (
          <pre className="whitespace-pre-wrap break-words rounded-sm bg-surface-2 p-3 font-mono text-xs leading-relaxed text-ink">{summaryText}</pre>
        ) : (
          <p className="card-quiet p-5 text-xs text-ink-2">
            No summary yet. Click <em>Regenerate from EDM body</em> if the body is present, or paste one
            yourself with <em>Edit</em>.
          </p>
        )
      ) : (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="field h-40 w-full font-mono"
            placeholder={'Date: ...\nTime: ...\nVenue: ...\nDress code: ...\nHighlights:\n  • ...'}
          />
          <button
            type="button"
            onClick={save}
            disabled={isPending}
            className="btn-primary btn-sm disabled:opacity-50"
          >
            {isPending ? 'Saving…' : 'Save summary'}
          </button>
        </>
      )}
    </div>
  );
}
