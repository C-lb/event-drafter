'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { summarizeEdm } from '@event-drafter/core/edm-extract';
import { createEventBlank } from '../../actions';

function nowLocalRoundedToHour(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  const tz = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 16);
}

export default function BlankEventPage() {
  const router = useRouter();
  const [isPending, start] = useTransition();
  const [name, setName] = useState('');
  const [dateLocal, setDateLocal] = useState<string>(nowLocalRoundedToHour);
  const [venue, setVenue] = useState('');
  const [edmSubject, setEdmSubject] = useState('');
  const [edmBody, setEdmBody] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Live preview of the EDM summary as the operator pastes the body. Same
  // heuristics that run server-side at insert time — shown here so the
  // operator can see whether their paste produced clean facts before saving.
  const previewSummary = useMemo(() => {
    if (!edmBody.trim()) return '';
    const fallbackYear = dateLocal ? new Date(dateLocal).getFullYear() : new Date().getFullYear();
    return summarizeEdm(edmBody, edmSubject, fallbackYear);
  }, [edmBody, edmSubject, dateLocal]);

  const submit = () => {
    setError(null);
    start(async () => {
      const r = await createEventBlank({
        name,
        event_date: new Date(dateLocal).toISOString(),
        venue,
        edm_subject: edmSubject,
        edm_body: edmBody,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.push(`/events/${r.id}`);
    });
  };

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-2xl font-semibold tracking-tight">New event from scratch</h2>
        <Link href="/events/new" className="text-xs font-medium text-accent hover:text-accent-hover">
          Use Gmail instead →
        </Link>
      </div>

      <p className="text-sm text-ink-2">
        For events where there's no email to pull from. Fill in the event facts; optionally
        paste the EDM body and we'll extract the structured summary used by the LLM and the
        starter-draft cards.
      </p>

      {error && (
        <p className="rounded-card bg-red-50 p-4 text-sm text-red-700 ring-1 ring-inset ring-red-600/20">{error}</p>
      )}

      <div className="card space-y-5 p-5">
        <label className="block text-xs">
          <span className="font-medium">Event title</span>
          <input
            className="field mt-1.5 w-full"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. SPARK Founders Lunch"
            autoFocus
          />
        </label>

        <label className="block text-xs">
          <span className="font-medium">Date &amp; time</span>
          <input
            type="datetime-local"
            className="field mt-1.5 w-full"
            value={dateLocal}
            onChange={(e) => setDateLocal(e.target.value)}
          />
        </label>

        <label className="block text-xs">
          <span className="font-medium">Venue (optional)</span>
          <input
            className="field mt-1.5 w-full"
            value={venue}
            onChange={(e) => setVenue(e.target.value)}
            placeholder="e.g. Garibaldi Italian Restaurant & Bar"
          />
        </label>

        <label className="block text-xs">
          <span className="font-medium">EDM subject (optional)</span>
          <input
            className="field mt-1.5 w-full"
            value={edmSubject}
            onChange={(e) => setEdmSubject(e.target.value)}
            placeholder="e.g. SPARK Founders Lunch, Wednesday 3 July 2026"
          />
        </label>

        <label className="block text-xs">
          <span className="font-medium">EDM body (optional)</span>
          <textarea
            className="field mt-1.5 h-48 w-full font-mono"
            value={edmBody}
            onChange={(e) => setEdmBody(e.target.value)}
            placeholder={'Date: ...\nTime: ...\nVenue: ...\nDress code: ...\nKey Program Highlights:\n• ...'}
          />
        </label>

        {previewSummary && (
          <div className="rounded-card bg-accent-soft p-4 text-xs text-accent ring-1 ring-inset ring-accent-line">
            <p className="mb-1 font-medium">Extracted summary (preview)</p>
            <pre className="whitespace-pre-wrap break-words font-mono">{previewSummary}</pre>
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={isPending || !name.trim() || !dateLocal}
            className="btn-primary"
          >
            {isPending ? 'Creating…' : 'Create event'}
          </button>
          <Link href="/events" className="btn">
            Cancel
          </Link>
        </div>
      </div>
    </section>
  );
}
