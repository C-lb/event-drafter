'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { updateEventCard } from './events/actions';

export interface StickyEvent {
  id: number;
  name: string;
  note: string | null;
  event_date_ms: number;
  venue: string | null;
  total_invites: number;
  replied: number;
  yes: number;
  no: number;
  maybe: number;
  unclear: number;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtDate(ms: number): string {
  const d = new Date(ms);
  let h = d.getHours();
  const ap = h < 12 ? 'am' : 'pm';
  h = h % 12 || 12;
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${h}:${mm}${ap}`;
}

function toDateInput(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

type Phase = 'idle' | 'saving' | 'saved' | 'error';

export function EventStickyCard({ ev, isPast }: { ev: StickyEvent; isPast: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(ev.name);
  const [note, setNote] = useState(ev.note ?? '');
  const [dateStr, setDateStr] = useState(toDateInput(ev.event_date_ms));
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);

  const startEdit = () => {
    setName(ev.name);
    setNote(ev.note ?? '');
    setDateStr(toDateInput(ev.event_date_ms));
    setError(null);
    setPhase('idle');
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
    setError(null);
    setPhase('idle');
  };

  const save = async () => {
    setPhase('saving');
    setError(null);
    // Keep the original time-of-day, only the calendar date is editable here.
    const [y, m, d] = dateStr.split('-').map(Number);
    const orig = new Date(ev.event_date_ms);
    const combined = new Date(y ?? orig.getFullYear(), (m ?? 1) - 1, d ?? 1, orig.getHours(), orig.getMinutes(), orig.getSeconds());
    const res = await updateEventCard({
      id: ev.id,
      name,
      note,
      event_date: combined.toISOString(),
    });
    if (!res.ok) {
      setPhase('error');
      setError(res.error);
      return;
    }
    setPhase('saved');
    router.refresh();
    // Brief confirmation, then drop back to the read view.
    setTimeout(() => {
      setEditing(false);
      setPhase('idle');
    }, 1200);
  };

  const statBadges = (
    <div className="mt-3 flex flex-wrap gap-1.5">
      <span className="badge badge-neutral">{ev.total_invites} invited</span>
      <span className={`badge ${ev.replied > 0 ? 'badge-blue' : 'badge-neutral'}`}>{ev.replied} replied</span>
      <span className={`badge ${ev.yes > 0 ? 'badge-green' : 'badge-neutral'}`}>{ev.yes} yes</span>
      <span className={`badge ${ev.no > 0 ? 'badge-red' : 'badge-neutral'}`}>{ev.no} no</span>
      <span className={`badge ${ev.maybe > 0 ? 'badge-amber' : 'badge-neutral'}`}>{ev.maybe} maybe</span>
    </div>
  );

  if (editing) {
    return (
      <li className="card p-5">
        <div className="flex items-start gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="field flex-1 font-semibold"
            placeholder="Event name"
            aria-label="Event name"
          />
          <input
            type="date"
            value={dateStr}
            onChange={(e) => setDateStr(e.target.value)}
            className="field w-auto flex-none"
            aria-label="Event date"
          />
        </div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="field mt-3 h-24 resize-y bg-surface-2"
          placeholder="Add a note, sticky-note style. Reminders, to-dos, anything."
          aria-label="Note"
        />
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={phase === 'saving' || phase === 'saved' || !name.trim()}
            className={`btn-primary btn-sm ${phase === 'saving' || phase === 'saved' ? 'is-loading' : ''}`}
          >
            {phase === 'saving' && <span className="spinner" aria-hidden />}
            {phase === 'saved' && <span aria-hidden>✓</span>}
            {phase === 'saving' ? 'Saving…' : phase === 'saved' ? 'Saved' : 'Save'}
          </button>
          <button type="button" onClick={cancel} className="btn btn-sm" disabled={phase === 'saving'}>
            Cancel
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className={`card group relative p-5 transition-colors hover:border-line-strong ${isPast ? 'opacity-70' : ''}`}>
      {/* Stretched overlay: the whole card navigates to the event. Interactive
          controls below opt out by sitting above it with relative z-10. */}
      <Link
        href={`/events/${ev.id}`}
        className="absolute inset-0 z-0 rounded-card"
        aria-label={`Open ${ev.name}`}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {isPast && (
            <span
              className="grid h-5 w-5 flex-none place-items-center rounded-full bg-emerald-100 text-emerald-700"
              title="This event has passed"
              aria-label="Done"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </span>
          )}
          <span className="truncate font-semibold group-hover:text-accent">
            {ev.name}
          </span>
        </div>
        <span className="badge badge-neutral flex-none" suppressHydrationWarning>
          {fmtDate(ev.event_date_ms)}
        </span>
      </div>

      {ev.note ? (
        <p className="mt-3 whitespace-pre-wrap rounded-sm bg-surface-2 p-3 text-sm text-ink-2">{ev.note}</p>
      ) : (
        <button type="button" onClick={startEdit} className="relative z-10 mt-3 text-sm text-ink-3 hover:text-ink-2">
          Add a note
        </button>
      )}

      {statBadges}

      <div className="relative z-10 mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={startEdit} className="btn btn-sm">
          Edit
        </button>
      </div>
    </li>
  );
}
