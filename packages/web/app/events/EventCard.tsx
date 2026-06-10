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
  sent_invites: number;
  replied: number;
  not_replied: number;
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
    ? 'rounded border border-neutral-200 bg-neutral-50 p-3 opacity-70 hover:opacity-100 transition-opacity'
    : 'rounded border border-neutral-200 bg-white p-3';
  const dateBadgeCls = expired
    ? 'rounded bg-neutral-200 px-2 py-0.5 text-xs text-neutral-600'
    : 'rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800';

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
        <p className="font-medium">
          <Link href={`/events/${ev.id}`} className="hover:underline">{ev.name}</Link>
        </p>
        <span className={dateBadgeCls}>{dateLabel}</span>
      </div>
      <p className="mt-0.5 text-xs text-neutral-600">
        {new Date(ev.event_date).toLocaleString()} · {ev.venue ?? '—'} · {ev.status}
      </p>

      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        <span className="rounded bg-neutral-100 px-2 py-0.5">
          {ev.total_invites} invited · {ev.sent_invites} sent
        </span>
        <span className={`rounded px-2 py-0.5 ${ev.replied > 0 ? 'bg-green-100 text-green-800' : 'bg-neutral-100 text-neutral-600'}`}>
          {ev.replied} replied
        </span>
        <span className={`rounded px-2 py-0.5 ${ev.not_replied > 0 ? 'bg-amber-100 text-amber-800' : 'bg-neutral-100 text-neutral-600'}`}>
          {ev.not_replied} no reply
        </span>
      </div>

      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        <Link
          href={`/events/${ev.id}`}
          className="rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-100"
        >
          Open
        </Link>
        <Link
          href={`/events/${ev.id}#edit`}
          className="rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-100"
        >
          Edit
        </Link>
        <button
          onClick={() => { setConfirmOpen((v) => !v); setError(null); }}
          className="rounded border border-red-300 px-2 py-1 text-red-700 hover:bg-red-50"
          type="button"
        >
          Delete…
        </button>
      </div>

      {confirmOpen && (
        <div className="mt-2 rounded border border-red-300 bg-red-50 p-3 text-xs">
          <p className="font-medium text-red-900">
            Delete this event and cascade-delete all of its invites, replies, and follow-ups.
          </p>
          <p className="mt-1 text-red-800">
            Type the event name exactly to confirm: <code className="rounded bg-white px-1 font-mono">{ev.name}</code>
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              type="text"
              value={confirmPhrase}
              onChange={(e) => setConfirmPhrase(e.target.value)}
              placeholder={ev.name}
              className="flex-1 min-w-[180px] rounded border border-red-400 px-2 py-1 font-mono"
            />
            <button
              onClick={doDelete}
              disabled={isPending || confirmPhrase !== ev.name}
              className="rounded bg-red-700 px-3 py-1 font-medium text-white disabled:opacity-50"
              type="button"
            >
              {isPending ? 'Deleting…' : 'Delete event'}
            </button>
            <button
              onClick={() => { setConfirmOpen(false); setConfirmPhrase(''); setError(null); }}
              className="rounded border border-neutral-300 px-3 py-1"
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
