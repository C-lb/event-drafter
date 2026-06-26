'use client';

import { useEffect, useState, useTransition } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { listCandidatesForEvent, enqueueDraftsForContacts } from '../actions';
import type { Contact } from '@event-drafter/core';

/**
 * Parse a row-range expression like "12-41, 52, 69-106" into a sorted list of
 * 1-based row numbers, clamped to [1, max]. Anything out of range or malformed
 * sets hadInvalid so the UI can warn.
 */
function parseRowExpr(expr: string, max: number): { rows: number[]; hadInvalid: boolean } {
  const rows = new Set<number>();
  let hadInvalid = false;
  for (const rawPart of expr.split(',')) {
    const part = rawPart.trim();
    if (!part) continue;
    const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      let a = Number(range[1]);
      let b = Number(range[2]);
      if (a > b) [a, b] = [b, a];
      for (let n = a; n <= b; n++) {
        if (n >= 1 && n <= max) rows.add(n);
        else hadInvalid = true;
      }
    } else if (/^\d+$/.test(part)) {
      const n = Number(part);
      if (n >= 1 && n <= max) rows.add(n);
      else hadInvalid = true;
    } else {
      hadInvalid = true;
    }
  }
  return { rows: [...rows].sort((x, y) => x - y), hadInvalid };
}

export default function PickContactsPage() {
  const params = useParams<{ id: string }>();
  const eventId = Number(params.id);
  const router = useRouter();

  const [candidates, setCandidates] = useState<Contact[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState('');
  const [isPending, start] = useTransition();
  const [lastIndex, setLastIndex] = useState<number | null>(null);
  const [rowExpr, setRowExpr] = useState('');
  const [rowNote, setRowNote] = useState<string | null>(null);

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

  const selectByRows = () => {
    if (!rowExpr.trim()) return;
    const { rows, hadInvalid } = parseRowExpr(rowExpr, candidates.length);
    if (rows.length === 0) {
      setRowNote(`No valid rows in 1–${candidates.length}.`);
      return;
    }
    const next = new Set(picked);
    for (const n of rows) {
      const c = candidates[n - 1]; // rows are 1-based
      if (c) next.add(c.id);
    }
    setPicked(next);
    setLastIndex(null);
    setRowNote(`Added ${rows.length} row${rows.length === 1 ? '' : 's'}${hadInvalid ? ` · ignored entries outside 1–${candidates.length}` : ''}.`);
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
    <section className="space-y-6">
      <h2 className="text-2xl font-semibold tracking-tight">Pick contacts to invite</h2>

      <div className="flex gap-2">
        <input
          className="field flex-1"
          placeholder="search name or remarks…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') load(); }}
        />
        <button onClick={load} className="btn">Search</button>
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-ink-2">
          {picked.size} selected · {candidates.length} candidates (excluding already-invited)
        </p>
        <div className="flex gap-2 text-xs">
          <button
            onClick={selectAll}
            disabled={candidates.length === 0 || picked.size === candidates.length}
            className="btn btn-sm"
          >
            Select all ({candidates.length})
          </button>
          <button
            onClick={clearAll}
            disabled={picked.size === 0}
            className="btn btn-sm"
          >
            Clear
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="field flex-1 min-w-[14rem]"
          placeholder="pick rows, e.g. 12-41, 52, 69-106"
          value={rowExpr}
          onChange={(e) => setRowExpr(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') selectByRows(); }}
          aria-label="Select by row numbers"
        />
        <button onClick={selectByRows} disabled={!rowExpr.trim() || candidates.length === 0} className="btn btn-sm">
          Select rows
        </button>
      </div>
      <p className="text-[11px] text-ink-3">
        {rowNote ?? 'Tip: shift-click to select a range, or type row numbers above. Rows are numbered in the list below and follow the current search/sort.'}
      </p>

      <ul className="space-y-1">
        {candidates.map((c, i) => (
          <li
            key={c.id}
            onClick={(e) => toggle(c.id, i, e.shiftKey)}
            className={`flex cursor-pointer select-none items-baseline gap-3 rounded-sm p-3 text-sm ${picked.has(c.id) ? 'bg-accent-soft ring-1 ring-inset ring-accent-line' : 'card'}`}
          >
            <span className="w-10 flex-none text-right font-mono text-xs tabular-nums text-ink-3">{i + 1}</span>
            <span className="min-w-0">
              <p className="font-medium">{c.first_name}{c.last_name ? ' ' + c.last_name : ''} <span className="text-xs text-ink-3">{c.phone_e164}</span></p>
              {c.remarks && <p className="text-xs text-ink-2">{c.remarks}</p>}
            </span>
          </li>
        ))}
      </ul>

      <div className="sticky bottom-0 bg-canvas p-3 border-t border-line">
        <button
          onClick={generate}
          disabled={isPending || picked.size === 0}
          className="btn-primary"
        >
          Generate {picked.size} draft{picked.size === 1 ? '' : 's'}
        </button>
      </div>
    </section>
  );
}
