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
  const [lastIndex, setLastIndex] = useState<number | null>(null);

  const load = () => start(async () => {
    setCandidates(await listCandidatesForEvent(eventId, { search, exclude_invited: true }));
  });

  useEffect(() => { load(); }, []);

  const toggle = (id: number, index: number, shiftKey: boolean) => {
    const next = new Set(picked);
    // Shift-click selects (or deselects) the range from the last clicked row
    // to the current one, matching the new state of the current row. If no
    // anchor exists yet, behave like a normal click.
    if (shiftKey && lastIndex !== null && lastIndex !== index) {
      const [from, to] = lastIndex < index ? [lastIndex, index] : [index, lastIndex];
      const turnOn = !next.has(id);
      for (let i = from; i <= to; i++) {
        const c = candidates[i];
        if (!c) continue;
        if (turnOn) next.add(c.id); else next.delete(c.id);
      }
    } else if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setPicked(next);
    setLastIndex(index);
  };

  const selectAll = () => {
    setPicked(new Set(candidates.map((c) => c.id)));
    setLastIndex(null);
  };
  const clearAll = () => {
    setPicked(new Set());
    setLastIndex(null);
  };

  const generate = () => start(async () => {
    await enqueueDraftsForContacts({ event_id: eventId, contact_ids: Array.from(picked) });
    router.push(`/events/${eventId}/queue`);
  });

  return (
    <section className="max-w-7xl space-y-4">
      <h2 className="text-3xl font-semibold tracking-tight">Pick contacts to invite</h2>

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

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-neutral-600">
          {picked.size} selected · {candidates.length} candidates (excluding already-invited)
        </p>
        <div className="flex gap-2 text-xs">
          <button
            onClick={selectAll}
            disabled={candidates.length === 0 || picked.size === candidates.length}
            className="rounded border border-neutral-300 px-2 py-1 disabled:opacity-50"
          >
            Select all ({candidates.length})
          </button>
          <button
            onClick={clearAll}
            disabled={picked.size === 0}
            className="rounded border border-neutral-300 px-2 py-1 disabled:opacity-50"
          >
            Clear
          </button>
        </div>
      </div>
      <p className="text-[11px] text-neutral-500">Tip: shift-click to select a range.</p>

      <ul className="space-y-1">
        {candidates.map((c, i) => (
          <li
            key={c.id}
            onClick={(e) => toggle(c.id, i, e.shiftKey)}
            className={`cursor-pointer select-none rounded border p-2 text-sm ${picked.has(c.id) ? 'border-blue-500 bg-blue-50' : 'border-neutral-200 bg-white'}`}
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
