'use client';

import { useEffect, useState, useTransition } from 'react';
import { useParams } from 'next/navigation';
import {
  listRepliesForEvent,
  approveResponse,
  skipResponse,
  markResponseSent,
  editResponse,
} from '../actions';

type Row = Awaited<ReturnType<typeof listRepliesForEvent>>[number];

const CLASS_BADGES = {
  yes: 'bg-green-600 text-white',
  no: 'bg-red-600 text-white',
  maybe: 'bg-yellow-500 text-white',
  unclear: 'bg-neutral-400 text-white',
} as const;

export default function EventRepliesPage() {
  const params = useParams<{ id: string }>();
  const eventId = Number(params.id);
  const [rows, setRows] = useState<Row[]>([]);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [filter, setFilter] = useState<'all' | 'yes' | 'no' | 'maybe' | 'unclear'>('all');
  const [isPending, start] = useTransition();

  const refresh = () => start(async () => setRows(await listRepliesForEvent(eventId)));

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, []);

  const visible = rows.filter((r) => filter === 'all' || r.classification === filter);

  return (
    <section className="max-w-3xl space-y-4">
      <h2 className="text-xl font-semibold">Replies</h2>

      <div className="flex gap-2 text-xs">
        {(['all', 'yes', 'no', 'maybe', 'unclear'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`rounded px-2 py-1 ${filter === s ? 'bg-blue-600 text-white' : 'bg-neutral-200'}`}
          >
            {s} ({rows.filter((r) => s === 'all' || r.classification === s).length})
          </button>
        ))}
      </div>

      <ul className="space-y-3">
        {visible.map((r) => {
          const editValue = edits[r.reply_id] ?? r.response_draft ?? '';
          const dirty = (r.response_draft ?? '') !== editValue;
          const badge = r.classification ? CLASS_BADGES[r.classification] : 'bg-neutral-200';
          return (
            <li key={r.reply_id} className="rounded border border-neutral-200 bg-white p-3 space-y-2">
              <div className="flex items-baseline justify-between">
                <p className="font-medium">{r.contact_name}</p>
                <div className="flex items-center gap-2 text-xs">
                  {r.classification && (
                    <span className={`rounded px-2 py-0.5 ${badge}`}>
                      {r.classification} {r.confidence !== null && r.confidence !== undefined ? `(${Math.round(r.confidence * 100)}%)` : ''}
                    </span>
                  )}
                  <span className="rounded bg-neutral-100 px-2 py-0.5">{r.response_status ?? 'pending'}</span>
                </div>
              </div>
              {r.summary && <p className="text-xs italic text-neutral-600">{r.summary}</p>}

              <div className="rounded bg-neutral-50 p-2 text-sm">
                <p className="text-xs text-neutral-500">Their reply:</p>
                <p className="whitespace-pre-wrap">{r.reply_text}</p>
              </div>

              <textarea
                className="h-20 w-full rounded border border-neutral-300 p-2 text-sm"
                value={editValue}
                onChange={(e) => setEdits({ ...edits, [r.reply_id]: e.target.value })}
                placeholder="(no draft yet)"
              />

              <div className="flex flex-wrap gap-2 text-xs">
                {r.response_status === 'prefilled' ? (
                  <>
                    <span className="rounded bg-yellow-100 px-2 py-1 text-yellow-800">
                      ✋ Pre-filled in WA — click send there, then:
                    </span>
                    <button
                      onClick={() => start(async () => { await markResponseSent({ reply_id: r.reply_id }); refresh(); })}
                      className="rounded bg-green-700 px-2 py-1 text-white"
                    >
                      Mark sent
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      disabled={!dirty || isPending || r.response_status === 'sent'}
                      onClick={() => start(async () => { await editResponse({ reply_id: r.reply_id, response_draft: editValue }); refresh(); })}
                      className="rounded border border-neutral-300 px-2 py-1 disabled:opacity-50"
                    >
                      Save edits
                    </button>
                    <button
                      disabled={isPending || !r.response_draft || r.response_status === 'approved' || r.response_status === 'sent'}
                      onClick={() => start(async () => { await approveResponse({ reply_id: r.reply_id }); refresh(); })}
                      className="rounded bg-green-600 px-2 py-1 text-white disabled:opacity-50"
                    >
                      Approve &amp; send
                    </button>
                    <button
                      disabled={isPending || r.response_status === 'sent'}
                      onClick={() => start(async () => { await skipResponse({ reply_id: r.reply_id }); refresh(); })}
                      className="rounded border border-neutral-300 px-2 py-1 disabled:opacity-50"
                    >
                      Skip
                    </button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
