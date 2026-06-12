'use client';

import { useEffect, useState, useTransition } from 'react';
import { useParams } from 'next/navigation';
import {
  listRepliesForEvent,
  approveResponse,
  skipResponse,
  markResponseSent,
  editResponse,
  regenerateResponse,
  setEventReplyResolved,
} from '../actions';

type Row = Awaited<ReturnType<typeof listRepliesForEvent>>[number];

interface ClassificationVisual { label: string; glyph: string; cls: string }

function classificationVisual(c: string | null | undefined): ClassificationVisual {
  switch (c) {
    case 'yes':
      return { label: 'YES', glyph: '✓', cls: 'bg-green-600 text-white border-green-700 ring-2 ring-green-200' };
    case 'no':
      return { label: 'NO', glyph: '✕', cls: 'bg-red-600 text-white border-red-700 ring-2 ring-red-200' };
    case 'maybe':
      return { label: 'MAYBE', glyph: '?', cls: 'bg-amber-500 text-white border-amber-600 ring-2 ring-amber-200' };
    case 'unclear':
      return { label: 'UNCLEAR', glyph: '…', cls: 'bg-neutral-500 text-white border-neutral-600 ring-2 ring-neutral-200' };
    default:
      return { label: 'UNCLASSIFIED', glyph: '·', cls: 'bg-neutral-200 text-neutral-700 border-neutral-300' };
  }
}

export default function EventRepliesPage() {
  const params = useParams<{ id: string }>();
  const eventId = Number(params.id);
  const [rows, setRows] = useState<Row[]>([]);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [filter, setFilter] = useState<'all' | 'yes' | 'no' | 'maybe' | 'unclear'>('all');
  const [showResolved, setShowResolved] = useState(false);
  const [isPending, start] = useTransition();

  const refresh = () =>
    start(async () => setRows(await listRepliesForEvent(eventId, showResolved)));

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showResolved]);

  const visible = rows.filter((r) => filter === 'all' || r.classification === filter);

  return (
    <section className="max-w-7xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-3xl font-semibold tracking-tight">Replies</h2>
        <label className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
          />
          Show resolved
        </label>
      </div>

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
          const cv = classificationVisual(r.classification);
          return (
            <li
              key={r.reply_id}
              className={`rounded border bg-white p-3 space-y-2 ${
                r.resolved ? 'border-neutral-200 opacity-70' : 'border-neutral-200'
              }`}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`flex flex-none flex-col items-center justify-center rounded-md border px-2 py-1 text-xs font-semibold ${cv.cls}`}
                  title={`Classification: ${cv.label}`}
                >
                  <span className="text-base leading-none">{cv.glyph}</span>
                  <span className="mt-0.5 leading-none tracking-wide">{cv.label}</span>
                  {r.confidence !== null && r.confidence !== undefined && (
                    <span className="mt-0.5 text-[10px] font-normal opacity-90">
                      {Math.round(r.confidence * 100)}%
                    </span>
                  )}
                </div>
                <div className="flex-1">
                  <p className="font-medium">{r.contact_name}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded bg-neutral-100 px-2 py-0.5">{r.response_status ?? 'pending'}</span>
                    {r.resolved && <span className="rounded bg-neutral-200 px-2 py-0.5 text-neutral-600">resolved</span>}
                  </div>
                </div>
                <button
                  onClick={() => start(async () => { await setEventReplyResolved({ reply_id: r.reply_id, resolved: !r.resolved }); refresh(); })}
                  disabled={isPending}
                  className={`flex-none rounded border px-2 py-1 text-xs ${
                    r.resolved
                      ? 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50'
                      : 'border-green-300 bg-green-50 text-green-800 hover:bg-green-100'
                  }`}
                >
                  {r.resolved ? 'Reopen' : 'Mark resolved'}
                </button>
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
                    <button
                      // We're inside the `status !== 'prefilled'` branch, so
                      // 'prefilled' is already excluded by the outer ternary;
                      // only need to guard against approved/sent here.
                      disabled={
                        isPending ||
                        r.response_status === 'approved' ||
                        r.response_status === 'sent'
                      }
                      onClick={() => start(async () => { await regenerateResponse({ reply_id: r.reply_id }); refresh(); })}
                      className="rounded border border-neutral-300 px-2 py-1 disabled:opacity-50"
                      title="Re-run the LLM to draft a fresh response"
                    >
                      ↻ Regenerate
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
