'use client';

import { useEffect, useState, useTransition } from 'react';
import { useParams } from 'next/navigation';
import {
  listInvitesForEvent,
  editDraft,
  approveDraft,
  skipDraft,
  regenerateDraft,
  markSent,
  reprefill,
} from '../actions';

type Row = Awaited<ReturnType<typeof listInvitesForEvent>>[number];

export default function QueuePage() {
  const params = useParams<{ id: string }>();
  const eventId = Number(params.id);

  const [rows, setRows] = useState<Row[]>([]);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [isPending, start] = useTransition();
  const [filter, setFilter] = useState<'all' | 'pending' | 'drafted' | 'approved' | 'prefilled' | 'sent' | 'skipped' | 'failed'>('drafted');

  const refresh = () => start(async () => setRows(await listInvitesForEvent(eventId)));

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, []);

  const visible = rows.filter((r) => filter === 'all' || r.status === filter);

  return (
    <section className="max-w-3xl space-y-4">
      <h2 className="text-xl font-semibold">Review queue</h2>

      <div className="flex flex-wrap gap-2 text-xs">
        {(['all', 'pending', 'drafted', 'approved', 'prefilled', 'sent', 'skipped', 'failed'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`rounded px-2 py-1 ${filter === s ? 'bg-blue-600 text-white' : 'bg-neutral-200'}`}
          >
            {s} ({rows.filter((r) => s === 'all' || r.status === s).length})
          </button>
        ))}
      </div>

      <ul className="space-y-3">
        {visible.map((r) => {
          const editValue = edits[r.invite_id] ?? r.draft_text ?? '';
          const dirty = (r.draft_text ?? '') !== editValue;
          return (
            <li key={r.invite_id} className="rounded border border-neutral-200 bg-white p-3 space-y-2">
              <div className="flex items-baseline justify-between">
                <p className="font-medium">{r.contact_name} <span className="text-xs text-neutral-500">{r.phone_e164}</span></p>
                <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs">{r.status}</span>
              </div>
              {r.personal_note && <p className="text-xs text-neutral-600 italic">hook: {r.personal_note}</p>}

              {r.status === 'pending' ? (
                <p className="text-xs text-neutral-500">Drafting… (refreshes every 2s)</p>
              ) : (
                <>
                  <textarea
                    className="h-24 w-full rounded border border-neutral-300 p-2 text-sm"
                    value={editValue}
                    onChange={(e) => setEdits({ ...edits, [r.invite_id]: e.target.value })}
                  />
                  <div className="flex flex-wrap gap-2 text-xs">
                    {r.status === 'prefilled' ? (
                      <>
                        <span className="rounded bg-yellow-100 px-2 py-1 text-yellow-800">
                          ✋ Pre-filled in WA — click send there, then:
                        </span>
                        <button
                          disabled={isPending}
                          onClick={() => start(async () => { await markSent({ invite_id: r.invite_id }); refresh(); })}
                          className="rounded bg-green-700 px-2 py-1 text-white disabled:opacity-50"
                        >
                          Mark sent
                        </button>
                        <button
                          disabled={isPending}
                          onClick={() => start(async () => { await reprefill({ invite_id: r.invite_id }); refresh(); })}
                          className="rounded border border-neutral-300 px-2 py-1 disabled:opacity-50"
                        >
                          Re-prefill
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          disabled={!dirty || isPending || r.status === 'sent'}
                          onClick={() => start(async () => { await editDraft({ invite_id: r.invite_id, draft_text: editValue }); refresh(); })}
                          className="rounded border border-neutral-300 px-2 py-1 disabled:opacity-50"
                        >
                          Save edits
                        </button>
                        <button
                          disabled={isPending || r.status === 'approved' || r.status === 'sent'}
                          onClick={() => start(async () => { await approveDraft({ invite_id: r.invite_id }); refresh(); })}
                          className="rounded bg-green-600 px-2 py-1 text-white disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          disabled={isPending || r.status === 'sent'}
                          onClick={() => start(async () => { await skipDraft({ invite_id: r.invite_id }); refresh(); })}
                          className="rounded border border-neutral-300 px-2 py-1 disabled:opacity-50"
                        >
                          Skip
                        </button>
                        <button
                          disabled={isPending || r.status === 'sent'}
                          onClick={() => start(async () => { await regenerateDraft({ invite_id: r.invite_id }); refresh(); })}
                          className="rounded border border-neutral-300 px-2 py-1 disabled:opacity-50"
                        >
                          Regenerate
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
