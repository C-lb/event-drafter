'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { summarizeEdm } from '@vip/core/edm-extract';
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
    <section className="max-w-2xl space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-3xl font-semibold tracking-tight">New event from scratch</h2>
        <Link href="/events/new" className="text-xs text-blue-700 underline">
          Use Gmail instead →
        </Link>
      </div>

      <p className="text-sm text-neutral-600">
        For events where there's no email to pull from. Fill in the event facts; optionally
        paste the EDM body and we'll extract the structured summary used by the LLM and the
        starter-draft cards.
      </p>

      {error && <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="space-y-3 rounded border border-neutral-200 bg-white p-4">
        <label className="block text-xs">
          <span className="font-medium">Event title</span>
          <input
            className="mt-0.5 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
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
            className="mt-0.5 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
            value={dateLocal}
            onChange={(e) => setDateLocal(e.target.value)}
          />
        </label>

        <label className="block text-xs">
          <span className="font-medium">Venue (optional)</span>
          <input
            className="mt-0.5 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
            value={venue}
            onChange={(e) => setVenue(e.target.value)}
            placeholder="e.g. Garibaldi Italian Restaurant & Bar"
          />
        </label>

        <label className="block text-xs">
          <span className="font-medium">EDM subject (optional)</span>
          <input
            className="mt-0.5 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
            value={edmSubject}
            onChange={(e) => setEdmSubject(e.target.value)}
            placeholder="e.g. SPARK Founders Lunch — Wednesday 3 July 2026"
          />
        </label>

        <label className="block text-xs">
          <span className="font-medium">EDM body (optional)</span>
          <textarea
            className="mt-0.5 h-48 w-full rounded border border-neutral-300 px-3 py-2 text-sm font-mono"
            value={edmBody}
            onChange={(e) => setEdmBody(e.target.value)}
            placeholder={'Date: ...\nTime: ...\nVenue: ...\nDress code: ...\nKey Program Highlights:\n• ...'}
          />
        </label>

        {previewSummary && (
          <div className="rounded border border-blue-200 bg-blue-50 p-3 text-xs">
            <p className="mb-1 font-medium text-blue-900">Extracted summary (preview)</p>
            <pre className="whitespace-pre-wrap break-words font-mono text-blue-900">{previewSummary}</pre>
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={isPending || !name.trim() || !dateLocal}
            className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {isPending ? 'Creating…' : 'Create event'}
          </button>
          <Link
            href="/events"
            className="rounded border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-50"
          >
            Cancel
          </Link>
        </div>
      </div>
    </section>
  );
}
