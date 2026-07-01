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
    <section className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-2xl font-semibold tracking-tight">Follow-ups</h2>
        <div className="flex items-center gap-2">
          <a href="/settings/timing" className="btn btn-sm">Timing</a>
          <button
            onClick={() => start(async () => { await triggerFollowUpGeneration(); refresh(); })}
            className="btn btn-sm"
          >
            Generate now
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 text-sm">
        {(['all', 'drafted', 'approved', 'prefilled', 'sent', 'skipped', 'failed'] as const).map((s) => (
          <button key={s} onClick={() => setFilter(s)} className={`badge ${filter === s ? 'badge-blue' : 'badge-neutral'} capitalize`}>
            {s} ({rows.filter((r) => s === 'all' || r.status === s).length})
          </button>
        ))}
      </div>

      {visible.length === 0 && (
        <p className="card-quiet p-6 text-center text-sm text-ink-2">
          No follow-ups for now.
        </p>
      )}

      <ul className="space-y-3">
        {visible.map((r) => {
          const editValue = edits[r.follow_up_id] ?? r.draft_text ?? '';
          const dirty = (r.draft_text ?? '') !== editValue;
          return (
            <li key={r.follow_up_id} className="card p-4 space-y-2">
              <div className="flex items-baseline justify-between">
                <p className="font-medium text-ink">{r.contact_name} <span className="text-xs text-ink-3">→ {r.event_name}</span></p>
                <span className="badge badge-neutral">{r.status}</span>
              </div>
              <textarea
                className="field h-20 w-full"
                value={editValue}
                onChange={(e) => setEdits({ ...edits, [r.follow_up_id]: e.target.value })}
              />
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {r.status === 'prefilled' ? (
                  <>
                    <span className="badge badge-amber">Pre-filled. Send in WhatsApp, then:</span>
                    <button
                      disabled={isPending}
                      onClick={() => start(async () => { await markFollowUpSent({ follow_up_id: r.follow_up_id }); refresh(); })}
                      className="btn-primary btn-sm bg-emerald-600 hover:bg-emerald-700"
                      style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18), 0 12px 26px -16px rgba(5,150,105,0.6)' }}
                    >Mark sent</button>
                  </>
                ) : (
                  <>
                    <button
                      disabled={!dirty || isPending}
                      onClick={() => start(async () => { await editFollowUp({ follow_up_id: r.follow_up_id, draft_text: editValue }); refresh(); })}
                      className="btn btn-sm"
                    >Save edits</button>
                    <button
                      disabled={isPending || r.status === 'approved' || r.status === 'sent'}
                      onClick={() => start(async () => { await approveFollowUp({ follow_up_id: r.follow_up_id }); refresh(); })}
                      className="btn-primary btn-sm bg-emerald-600 hover:bg-emerald-700"
                      style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18), 0 12px 26px -16px rgba(5,150,105,0.6)' }}
                    >Approve &amp; send</button>
                    <button
                      disabled={isPending || r.status === 'sent'}
                      onClick={() => start(async () => { await skipFollowUp({ follow_up_id: r.follow_up_id }); refresh(); })}
                      className="btn btn-sm"
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
