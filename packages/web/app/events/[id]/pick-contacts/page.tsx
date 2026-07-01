'use client';

import { useEffect, useState, useTransition } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { listCandidatesForEvent, addContactsToEvent } from '../actions';
import type { Contact } from '@event-drafter/core';

/**
 * Parse a row-range expression like "12-41, 52, 69-106" into the set of sheet
 * row numbers it names. Ranges expand fully; gaps (row numbers with no contact)
 * are fine and just match nothing. Only non-numeric junk sets hadInvalid.
 */
function parseRowExpr(expr: string): { rows: Set<number>; hadInvalid: boolean } {
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
      for (let n = a; n <= b; n++) rows.add(n);
    } else if (/^\d+$/.test(part)) {
      rows.add(Number(part));
    } else {
      hadInvalid = true;
    }
  }
  return { rows, hadInvalid };
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
    const { rows, hadInvalid } = parseRowExpr(rowExpr);
    if (rows.size === 0) {
      setRowNote('Type sheet row numbers like 12-41, 52.');
      return;
    }
    // Match against each contact's real sheet row number, not its position in
    // the list. Row numbers in the expression that hit a gap match nothing.
    const next = new Set(picked);
    let matched = 0;
    for (const c of candidates) {
      if (c.sheet_row_index != null && rows.has(c.sheet_row_index)) {
        next.add(c.id);
        matched++;
      }
    }
    setPicked(next);
    setLastIndex(null);
    if (matched === 0) {
      setRowNote('No contacts match those row numbers.');
    } else {
      setRowNote(`Added ${matched} contact${matched === 1 ? '' : 's'}${hadInvalid ? ' · ignored malformed entries' : ''}.`);
    }
  };

  const selectAll = () => {
    setPicked(new Set(candidates.map((c) => c.id)));
    setLastIndex(null);
  };
  const clearAll = () => {
    setPicked(new Set());
    setLastIndex(null);
  };

  const addContacts = () => start(async () => {
    await addContactsToEvent({ event_id: eventId, contact_ids: Array.from(picked) });
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
        {rowNote ?? 'Tip: shift-click to select a range, or type row numbers above. Numbers match the source sheet rows (gaps are normal).'}
      </p>

      <ul className="space-y-1">
        {candidates.map((c, i) => (
          <li
            key={c.id}
            onClick={(e) => toggle(c.id, i, e.shiftKey)}
            className={`flex cursor-pointer select-none items-baseline gap-3 rounded-sm p-3 text-sm ${picked.has(c.id) ? 'bg-accent-soft ring-1 ring-inset ring-accent-line' : 'card'}`}
          >
            <span className="w-10 flex-none text-right font-mono text-xs tabular-nums text-ink-3">{c.sheet_row_index ?? '·'}</span>
            <span className="min-w-0">
              <p className="font-medium">{c.first_name}{c.last_name ? ' ' + c.last_name : ''} <span className="text-xs text-ink-3">{c.phone_e164}</span></p>
              {c.remarks && <p className="text-xs text-ink-2">{c.remarks}</p>}
            </span>
          </li>
        ))}
      </ul>

      <div className="sticky bottom-0 bg-canvas p-3 border-t border-line">
        <button
          onClick={addContacts}
          disabled={isPending || picked.size === 0}
          className="btn-primary"
        >
          {isPending ? 'Adding…' : `Add ${picked.size} contact${picked.size === 1 ? '' : 's'}`}
        </button>
        <p className="mt-1.5 text-[11px] text-ink-3">
          Contacts are added with no message yet. Draft them from the review queue with Auto-draft or a template.
        </p>
      </div>
    </section>
  );
}
