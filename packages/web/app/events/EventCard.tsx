'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { deleteEvent } from './actions';

interface CardEvent {
  id: number;
  name: string;
  event_date: Date | string;
  venue: string | null;
  status: string;
  total_invites: number;
  replied: number;
  yes: number;
  no: number;
  maybe: number;
  unclear: number;
}

interface Props {
  ev: CardEvent;
  expired: boolean;
  dateLabel: string;
}

export function EventCard({ ev, expired, dateLabel }: Props) {
  const router = useRouter();
  const [isPending, start] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmPhrase, setConfirmPhrase] = useState('');
  const [error, setError] = useState<string | null>(null);

  const wrapperCls = expired
    ? 'card p-5 opacity-70 hover:opacity-100 transition-opacity'
    : 'card p-5';
  const dateBadgeCls = expired ? 'badge badge-neutral' : 'badge badge-blue';

  const doDelete = () => {
    setError(null);
    start(async () => {
      const res = await deleteEvent({ id: ev.id, confirm_phrase: confirmPhrase });
      if (!res.ok) { setError(res.error); return; }
      router.refresh();
    });
  };

  return (
    <li className={wrapperCls}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-semibold">
          <Link href={`/events/${ev.id}`} className="hover:text-accent">{ev.name}</Link>
        </p>
        <span className={dateBadgeCls}>{dateLabel}</span>
      </div>
      <p className="mt-1 text-sm text-ink-2">
        {new Date(ev.event_date).toLocaleString()} · {ev.venue ?? 'No venue set'} · {ev.status}
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className="badge badge-neutral">{ev.total_invites} invited</span>
        <span className={`badge ${ev.replied > 0 ? 'badge-blue' : 'badge-neutral'}`}>
          {ev.replied} replied
        </span>
        <span className={`badge ${ev.yes > 0 ? 'badge-green' : 'badge-neutral'}`} title="Replies classified yes">
          {ev.yes} yes
        </span>
        <span className={`badge ${ev.no > 0 ? 'badge-red' : 'badge-neutral'}`} title="Replies classified no">
          {ev.no} no
        </span>
        <span className={`badge ${ev.maybe > 0 ? 'badge-amber' : 'badge-neutral'}`} title="Replies classified maybe">
          {ev.maybe} maybe
        </span>
        <span className="badge badge-neutral" title="Replies classified unclear">
          {ev.unclear} unclear
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link href={`/events/${ev.id}`} className="btn btn-sm">
          Open
        </Link>
        <Link href={`/events/${ev.id}#edit`} className="btn btn-sm">
          Edit
        </Link>
        <button
          onClick={() => { setConfirmOpen((v) => !v); setError(null); }}
          className="btn-ghost btn-sm text-red-600 hover:bg-red-50"
          type="button"
        >
          Delete
        </button>
      </div>

      {confirmOpen && (
        <div className="mt-3 rounded-card border border-red-200 bg-red-50 p-4 text-sm">
          <p className="font-medium text-red-900">
            Delete this event and all of its invites, replies, and follow-ups.
          </p>
          <p className="mt-1 text-red-800">
            Type <code className="rounded bg-white px-1.5 py-0.5 font-mono text-xs">XXX</code> to confirm.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              type="text"
              value={confirmPhrase}
              onChange={(e) => setConfirmPhrase(e.target.value)}
              placeholder="XXX"
              className="field min-w-[180px] flex-1 font-mono"
            />
            <button
              onClick={doDelete}
              disabled={isPending || confirmPhrase !== 'XXX'}
              className="btn-danger btn-sm"
              type="button"
            >
              {isPending ? 'Deleting…' : 'Delete event'}
            </button>
            <button
              onClick={() => { setConfirmOpen(false); setConfirmPhrase(''); setError(null); }}
              className="btn btn-sm"
              type="button"
            >
              Cancel
            </button>
          </div>
          {error && <p className="mt-2 text-red-800">{error}</p>}
        </div>
      )}
    </li>
  );
}
