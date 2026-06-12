'use client';

import { useEffect, useState, useTransition } from 'react';
import { useParams } from 'next/navigation';
import {
  listInvitesForEvent,
  editDraft,
  approveDraft,
  approveBatch,
  skipDraft,
  regenerateDraft,
  markSent,
  reprefill,
  getAutoSendEnabled,
  setAutoSendEnabled,
} from '../actions';
import { RateLimitTimer } from './RateLimitTimer';

type Row = Awaited<ReturnType<typeof listInvitesForEvent>>[number];

export default function QueuePage() {
  const params = useParams<{ id: string }>();
  const eventId = Number(params.id);

  const [rows, setRows] = useState<Row[]>([]);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [isPending, start] = useTransition();
  const [filter, setFilter] = useState<'all' | 'pending' | 'drafted' | 'approved' | 'prefilled' | 'sent' | 'skipped' | 'failed'>('drafted');

  const [autoSend, setAutoSend] = useState<boolean | null>(null);
  const refresh = () => start(async () => {
    setRows(await listInvitesForEvent(eventId));
    setAutoSend(await getAutoSendEnabled());
  });

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, []);

  const toggleAutoSend = () => {
    const next = !(autoSend ?? false);
    start(async () => {
      const r = await setAutoSendEnabled({ enabled: next });
      setAutoSend(r.enabled);
    });
  };

  const visible = rows.filter((r) => filter === 'all' || r.status === filter);
  const draftedCount = rows.filter((r) => r.status === 'drafted').length;
  const batchSize = Math.min(5, draftedCount);
  const [batchBanner, setBatchBanner] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const approveNext = () => {
    if (batchSize === 0) return;
    setBatchBanner(null);
    start(async () => {
      try {
        const r = await approveBatch({ event_id: eventId, limit: batchSize });
        setBatchBanner({ kind: 'ok', text: `Approved ${r.approved} draft${r.approved === 1 ? '' : 's'}. Worker will pre-fill them on its rate-limited cadence (CONTEXT.md).` });
        refresh();
      } catch (e) {
        setBatchBanner({ kind: 'err', text: e instanceof Error ? e.message : 'unknown' });
      }
    });
  };

  return (
    <section className="max-w-7xl space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-3xl font-semibold tracking-tight">Review queue</h2>
        <button
          onClick={approveNext}
          disabled={isPending || batchSize === 0}
          className="rounded bg-green-700 px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          title={
            batchSize === 0
              ? 'No drafted invites to approve.'
              : `Approves the next ${batchSize} drafted invite${batchSize === 1 ? '' : 's'} (oldest first). Send cadence still applies per CONTEXT.md.`
          }
        >
          Approve next {batchSize || 5}
        </button>
      </div>

      {batchBanner && (
        <div className={`rounded p-2 text-xs ${batchBanner.kind === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
          {batchBanner.text}
        </div>
      )}

      <RateLimitTimer />

      <div
        className={`flex items-center justify-between gap-3 rounded border p-2 text-xs ${
          autoSend ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-neutral-200 bg-neutral-50 text-neutral-700'
        }`}
      >
        <div>
          <strong>Send mode:</strong>{' '}
          {autoSend === null
            ? '…'
            : autoSend
            ? 'AUTO-SEND ON — worker clicks WA send button after pre-fill.'
            : 'Manual — worker pre-fills only; you click send in WA.'}{' '}
          {autoSend && (
            <span className="opacity-80">
              Rate limiter still enforces ≥2:59 between sends and 5–8 per batch (CONTEXT.md).
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={toggleAutoSend}
          disabled={isPending || autoSend === null}
          className="rounded border border-neutral-400 bg-white px-2 py-1 hover:bg-neutral-100 disabled:opacity-50"
        >
          {autoSend ? 'Switch to manual' : 'Enable auto-send'}
        </button>
      </div>

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
                <p className="font-medium">{r.first_name}{r.last_name ? ' ' + r.last_name : ''} <span className="text-xs text-neutral-500">{r.phone_e164}</span></p>
                <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs">{r.status}</span>
              </div>
              {r.remarks && <p className="text-xs text-neutral-600 italic">remarks: {r.remarks}</p>}

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
