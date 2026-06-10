'use client';

import { useEffect, useState, useTransition } from 'react';
import {
  listFollowUps,
  approveFollowUp,
  skipFollowUp,
  markFollowUpSent,
  editFollowUp,
  triggerFollowUpGeneration,
} from './actions';

type Row = Awaited<ReturnType<typeof listFollowUps>>[number];

export default function FollowUpsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [filter, setFilter] = useState<'all' | 'drafted' | 'approved' | 'prefilled' | 'sent' | 'skipped' | 'failed'>('drafted');
  const [isPending, start] = useTransition();

  const refresh = () => start(async () => setRows(await listFollowUps()));
  useEffect(() => { refresh(); const t = setInterval(refresh, 3000); return () => clearInterval(t); }, []);

  const visible = rows.filter((r) => filter === 'all' || r.status === filter);

  return (
    <section className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Follow-ups</h2>
        <button
          onClick={() => start(async () => { await triggerFollowUpGeneration(); refresh(); })}
          className="rounded border border-neutral-300 px-3 py-1 text-sm"
        >
          Generate now
        </button>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        {(['all', 'drafted', 'approved', 'prefilled', 'sent', 'skipped', 'failed'] as const).map((s) => (
          <button key={s} onClick={() => setFilter(s)} className={`rounded px-2 py-1 ${filter === s ? 'bg-blue-600 text-white' : 'bg-neutral-200'}`}>
            {s} ({rows.filter((r) => s === 'all' || r.status === s).length})
          </button>
        ))}
      </div>

      <ul className="space-y-3">
        {visible.map((r) => {
          const editValue = edits[r.follow_up_id] ?? r.draft_text ?? '';
          const dirty = (r.draft_text ?? '') !== editValue;
          return (
            <li key={r.follow_up_id} className="rounded border border-neutral-200 bg-white p-3 space-y-2">
              <div className="flex items-baseline justify-between">
                <p className="font-medium">{r.contact_name} <span className="text-xs text-neutral-500">→ {r.event_name}</span></p>
                <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs">{r.status}</span>
              </div>
              <textarea
                className="h-20 w-full rounded border border-neutral-300 p-2 text-sm"
                value={editValue}
                onChange={(e) => setEdits({ ...edits, [r.follow_up_id]: e.target.value })}
              />
              <div className="flex flex-wrap gap-2 text-xs">
                {r.status === 'prefilled' ? (
                  <>
                    <span className="rounded bg-yellow-100 px-2 py-1 text-yellow-800">✋ Pre-filled — send in WA, then:</span>
                    <button
                      disabled={isPending}
                      onClick={() => start(async () => { await markFollowUpSent({ follow_up_id: r.follow_up_id }); refresh(); })}
                      className="rounded bg-green-700 px-2 py-1 text-white"
                    >Mark sent</button>
                  </>
                ) : (
                  <>
                    <button
                      disabled={!dirty || isPending}
                      onClick={() => start(async () => { await editFollowUp({ follow_up_id: r.follow_up_id, draft_text: editValue }); refresh(); })}
                      className="rounded border border-neutral-300 px-2 py-1 disabled:opacity-50"
                    >Save edits</button>
                    <button
                      disabled={isPending || r.status === 'approved' || r.status === 'sent'}
                      onClick={() => start(async () => { await approveFollowUp({ follow_up_id: r.follow_up_id }); refresh(); })}
                      className="rounded bg-green-600 px-2 py-1 text-white disabled:opacity-50"
                    >Approve &amp; send</button>
                    <button
                      disabled={isPending || r.status === 'sent'}
                      onClick={() => start(async () => { await skipFollowUp({ follow_up_id: r.follow_up_id }); refresh(); })}
                      className="rounded border border-neutral-300 px-2 py-1 disabled:opacity-50"
                    >Skip</button>
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
