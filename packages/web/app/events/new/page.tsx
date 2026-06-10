'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { searchInbox, createEventFromMessage } from '../actions';
import type { GmailMessageSummary } from '@vip/worker/google/gmail';

export default function NewEventPage() {
  const router = useRouter();
  const [query, setQuery] = useState('newer_than:30d');
  const [results, setResults] = useState<GmailMessageSummary[]>([]);
  const [picked, setPicked] = useState<GmailMessageSummary | null>(null);
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [venue, setVenue] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [isPending, start] = useTransition();

  const search = () => start(async () => {
    setErr(null);
    try { setResults(await searchInbox(query)); }
    catch (e) { setErr(e instanceof Error ? e.message : 'unknown'); }
  });

  const submit = () => {
    if (!picked) return;
    start(async () => {
      try {
        await createEventFromMessage({
          gmail_message_id: picked.id,
          name,
          event_date: date,
          venue: venue || undefined,
        });
        router.push(`/events`);
      } catch (e) { setErr(e instanceof Error ? e.message : 'unknown'); }
    });
  };

  return (
    <section className="max-w-3xl space-y-4">
      <h2 className="text-xl font-semibold">New event from Gmail</h2>

      <div className="space-y-2">
        <label className="block text-sm font-medium">Gmail search</label>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded border border-neutral-300 px-3 py-2 text-sm"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. subject:invitation newer_than:30d"
          />
          <button onClick={search} disabled={isPending} className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white">
            Search
          </button>
        </div>
      </div>

      {err && <p className="rounded bg-red-50 p-3 text-sm text-red-700">{err}</p>}

      {results.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Results</h3>
          <ul className="space-y-1">
            {results.map((m) => (
              <li
                key={m.id}
                onClick={() => setPicked(m)}
                className={`cursor-pointer rounded border p-2 text-sm ${picked?.id === m.id ? 'border-blue-500 bg-blue-50' : 'border-neutral-200 bg-white'}`}
              >
                <p className="font-medium">{m.subject}</p>
                <p className="text-xs text-neutral-600">{m.from}</p>
                <p className="text-xs text-neutral-500">{m.snippet}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {picked && (
        <div className="space-y-2 rounded border border-neutral-200 bg-white p-3">
          <h3 className="text-sm font-semibold">Event details</h3>
          <input className="w-full rounded border border-neutral-300 px-3 py-2 text-sm" placeholder="Event name" value={name} onChange={(e) => setName(e.target.value)} />
          <input type="datetime-local" className="w-full rounded border border-neutral-300 px-3 py-2 text-sm" value={date} onChange={(e) => setDate(e.target.value)} />
          <input className="w-full rounded border border-neutral-300 px-3 py-2 text-sm" placeholder="Venue (optional)" value={venue} onChange={(e) => setVenue(e.target.value)} />
          <button onClick={submit} disabled={isPending || !name || !date} className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            Create event
          </button>
        </div>
      )}
    </section>
  );
}
