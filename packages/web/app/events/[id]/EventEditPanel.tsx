'use client';

import { useEffect, useState, useTransition } from 'react';
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
    edm_summary: string | null;
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
  const [edmSummary, setEdmSummary] = useState(event.edm_summary ?? '');

  // The "Edit" button on /events cards links here with #edit so the form
  // auto-opens and the page scrolls to it. Without this hook the operator
  // lands on the detail page with the form collapsed and nothing visible.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.location.hash === '#edit') {
      // Mount-only: open the form when arrived at via the #edit deep link. Can't
      // be derived during render (would mismatch the server-rendered HTML).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEditing(true);
      requestAnimationFrame(() => {
        document.getElementById('edit')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }, []);

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
        edm_summary: edmSummary,
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
    <div id="edit" className="space-y-3 scroll-mt-4">
      {banner && (
        <div className={banner.kind === 'ok'
          ? 'rounded-card bg-emerald-50 p-4 text-sm text-emerald-700 ring-1 ring-inset ring-emerald-600/20'
          : 'rounded-card bg-red-50 p-4 text-sm text-red-700 ring-1 ring-inset ring-red-600/20'}>
          {banner.text}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setEditing((v) => !v)}
          className="btn btn-sm"
          type="button"
        >
          {editing ? 'Cancel edit' : 'Edit event'}
        </button>
        <button
          onClick={() => setConfirmOpen((v) => !v)}
          className="btn-ghost btn-sm text-red-700"
          type="button"
        >
          Delete event…
        </button>
      </div>

      {editing && (
        <div className="card space-y-3 p-5">
          <label className="block text-xs">
            <span className="font-medium text-ink-2">Event title</span>
            <input className="field mt-0.5 w-full" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block text-xs">
            <span className="font-medium text-ink-2">Date & time</span>
            <input type="datetime-local" className="field mt-0.5 w-full" value={dateLocal} onChange={(e) => setDateLocal(e.target.value)} />
          </label>
          <label className="block text-xs">
            <span className="font-medium text-ink-2">Venue</span>
            <input className="field mt-0.5 w-full" value={venue} onChange={(e) => setVenue(e.target.value)} />
          </label>
          <label className="block text-xs">
            <span className="font-medium text-ink-2">EDM subject</span>
            <input className="field mt-0.5 w-full" value={edmSubject} onChange={(e) => setEdmSubject(e.target.value)} />
          </label>
          <label className="block text-xs">
            <span className="font-medium text-ink-2">EDM body</span>
            <textarea className="field mt-0.5 h-40 w-full font-mono" value={edmBody} onChange={(e) => setEdmBody(e.target.value)} />
          </label>
          <label className="block text-xs">
            <span className="font-medium text-ink-2">EDM summary</span>
            <textarea className="field mt-0.5 h-32 w-full font-mono" value={edmSummary} onChange={(e) => setEdmSummary(e.target.value)} placeholder="Date: ... | Venue: ... | etc." />
          </label>
          <button
            onClick={save}
            disabled={isPending}
            className="btn-primary btn-sm disabled:opacity-50"
          >
            {isPending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}

      {confirmOpen && (
        <div className="rounded-card bg-red-50 p-4 text-sm ring-1 ring-inset ring-red-600/20">
          <p className="font-medium text-red-900">
            Delete this event and cascade-delete all of its invites, replies, and follow-ups.
          </p>
          <p className="mt-1 text-red-700">
            Type the event name exactly to confirm: <code className="rounded-sm bg-surface px-1 font-mono">{event.name}</code>
          </p>
          <div className="mt-3 flex gap-2">
            <input
              type="text"
              value={confirmPhrase}
              onChange={(e) => setConfirmPhrase(e.target.value)}
              placeholder={event.name}
              className="field flex-1 font-mono"
            />
            <button
              onClick={remove}
              disabled={isPending || confirmPhrase !== event.name}
              className="btn-danger btn-sm disabled:opacity-50"
            >
              {isPending ? 'Deleting…' : 'Delete event'}
            </button>
            <button
              onClick={() => { setConfirmOpen(false); setConfirmPhrase(''); }}
              className="btn btn-sm"
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
