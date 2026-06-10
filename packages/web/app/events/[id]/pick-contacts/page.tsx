'use client';

import { useEffect, useState, useTransition } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { listCandidatesForEvent, enqueueDraftsForContacts } from '../actions';
import type { Contact } from '@vip/core';

export default function PickContactsPage() {
  const params = useParams<{ id: string }>();
  const eventId = Number(params.id);
  const router = useRouter();

  const [candidates, setCandidates] = useState<Contact[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState('');
  const [isPending, start] = useTransition();

  const load = () => start(async () => {
    setCandidates(await listCandidatesForEvent(eventId, { search, exclude_invited: true }));
  });

  useEffect(() => { load(); }, []);

  const toggle = (id: number) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id); else next.add(id);
    setPicked(next);
  };

  const generate = () => start(async () => {
    await enqueueDraftsForContacts({ event_id: eventId, contact_ids: Array.from(picked) });
    router.push(`/events/${eventId}/queue`);
  });

  return (
    <section className="max-w-3xl space-y-4">
      <h2 className="text-xl font-semibold">Pick contacts to invite</h2>

      <div className="flex gap-2">
        <input
          className="flex-1 rounded border border-neutral-300 px-3 py-2 text-sm"
          placeholder="search name or remarks…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') load(); }}
        />
        <button onClick={load} className="rounded border border-neutral-300 px-3 py-1 text-sm">Search</button>
      </div>

      <p className="text-xs text-neutral-600">
        {picked.size} selected · {candidates.length} candidates (excluding already-invited)
      </p>

      <ul className="space-y-1">
        {candidates.map((c) => (
          <li
            key={c.id}
            onClick={() => toggle(c.id)}
            className={`cursor-pointer rounded border p-2 text-sm ${picked.has(c.id) ? 'border-blue-500 bg-blue-50' : 'border-neutral-200 bg-white'}`}
          >
            <p className="font-medium">{c.first_name}{c.last_name ? ' ' + c.last_name : ''} <span className="text-xs text-neutral-500">{c.phone_e164}</span></p>
            {c.remarks && <p className="text-xs text-neutral-600">{c.remarks}</p>}
          </li>
        ))}
      </ul>

      <div className="sticky bottom-0 bg-white p-3 border-t">
        <button
          onClick={generate}
          disabled={isPending || picked.size === 0}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Generate {picked.size} draft{picked.size === 1 ? '' : 's'}
        </button>
      </div>
    </section>
  );
}
