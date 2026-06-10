'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateEvent, deleteEvent } from '../actions';

interface Props {
  event: {
    id: number;
    name: string;
    event_date: Date | string;
    venue: string | null;
    edm_subject: string | null;
    edm_body: string | null;
  };
}

function toDateTimeLocal(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  const tz = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 16);
}

export function EventEditPanel({ event }: Props) {
  const router = useRouter();
  const [isPending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmPhrase, setConfirmPhrase] = useState('');
  const [banner, setBanner] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const [name, setName] = useState(event.name);
  const [dateLocal, setDateLocal] = useState(toDateTimeLocal(event.event_date));
  const [venue, setVenue] = useState(event.venue ?? '');
  const [edmSubject, setEdmSubject] = useState(event.edm_subject ?? '');
  const [edmBody, setEdmBody] = useState(event.edm_body ?? '');

  const save = () => {
    setBanner(null);
    start(async () => {
      const res = await updateEvent({
        id: event.id,
        name,
        event_date: new Date(dateLocal).toISOString(),
        venue,
        edm_subject: edmSubject,
        edm_body: edmBody,
      });
      if (!res.ok) { setBanner({ kind: 'err', text: res.error }); return; }
      setBanner({ kind: 'ok', text: 'Saved.' });
      setEditing(false);
      router.refresh();
    });
  };

  const remove = () => {
    setBanner(null);
    start(async () => {
      const res = await deleteEvent({ id: event.id, confirm_phrase: confirmPhrase });
      if (!res.ok) { setBanner({ kind: 'err', text: res.error }); return; }
      router.push('/events');
    });
  };

  return (
    <div className="space-y-2">
      {banner && (
        <div className={`rounded p-2 text-sm ${banner.kind === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
          {banner.text}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setEditing((v) => !v)}
          className="rounded border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50"
          type="button"
        >
          {editing ? 'Cancel edit' : 'Edit event'}
        </button>
        <button
          onClick={() => setConfirmOpen((v) => !v)}
          className="rounded border border-red-300 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50"
          type="button"
        >
          Delete event…
        </button>
      </div>

      {editing && (
        <div className="space-y-2 rounded border border-blue-200 bg-blue-50/50 p-3">
          <label className="block text-xs">
            <span className="font-medium">Name</span>
            <input className="mt-0.5 w-full rounded border border-neutral-300 px-2 py-1 text-sm" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block text-xs">
            <span className="font-medium">Date & time</span>
            <input type="datetime-local" className="mt-0.5 w-full rounded border border-neutral-300 px-2 py-1 text-sm" value={dateLocal} onChange={(e) => setDateLocal(e.target.value)} />
          </label>
          <label className="block text-xs">
            <span className="font-medium">Venue</span>
            <input className="mt-0.5 w-full rounded border border-neutral-300 px-2 py-1 text-sm" value={venue} onChange={(e) => setVenue(e.target.value)} />
          </label>
          <label className="block text-xs">
            <span className="font-medium">EDM subject</span>
            <input className="mt-0.5 w-full rounded border border-neutral-300 px-2 py-1 text-sm" value={edmSubject} onChange={(e) => setEdmSubject(e.target.value)} />
          </label>
          <label className="block text-xs">
            <span className="font-medium">EDM body</span>
            <textarea className="mt-0.5 h-40 w-full rounded border border-neutral-300 px-2 py-1 text-sm font-mono" value={edmBody} onChange={(e) => setEdmBody(e.target.value)} />
          </label>
          <button
            onClick={save}
            disabled={isPending}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {isPending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}

      {confirmOpen && (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-sm">
          <p className="font-medium text-red-900">
            Delete this event and cascade-delete all of its invites, replies, and follow-ups.
          </p>
          <p className="mt-1 text-red-800">
            Type the event name exactly to confirm: <code className="rounded bg-white px-1 font-mono">{event.name}</code>
          </p>
          <div className="mt-2 flex gap-2">
            <input
              type="text"
              value={confirmPhrase}
              onChange={(e) => setConfirmPhrase(e.target.value)}
              placeholder={event.name}
              className="flex-1 rounded border border-red-400 px-2 py-1 font-mono text-sm"
            />
            <button
              onClick={remove}
              disabled={isPending || confirmPhrase !== event.name}
              className="rounded bg-red-700 px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
            >
              {isPending ? 'Deleting…' : 'Delete event'}
            </button>
            <button
              onClick={() => { setConfirmOpen(false); setConfirmPhrase(''); }}
              className="rounded border border-neutral-300 px-3 py-1 text-sm"
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
