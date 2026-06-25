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
import { triggerReplyCheck, latestReplyCheck } from '../../../replies/actions';

type Row = Awaited<ReturnType<typeof listRepliesForEvent>>[number];
type LastCheck = Awaited<ReturnType<typeof latestReplyCheck>>;

function ago(ts: Date | number | null | undefined): string {
  if (!ts) return '—';
  const ms = Date.now() - (ts instanceof Date ? ts.getTime() : Number(ts));
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

interface ClassificationVisual { label: string; glyph: string; cls: string }

function classificationVisual(c: string | null | undefined): ClassificationVisual {
  switch (c) {
    case 'yes':
      return { label: 'Yes', glyph: '✓', cls: 'bg-emerald-600 text-white border-emerald-700 ring-2 ring-emerald-200' };
    case 'no':
      return { label: 'No', glyph: '✕', cls: 'bg-red-600 text-white border-red-700 ring-2 ring-red-200' };
    case 'maybe':
      return { label: 'Maybe', glyph: '?', cls: 'bg-amber-500 text-white border-amber-600 ring-2 ring-amber-200' };
    case 'unclear':
      return { label: 'Unclear', glyph: '…', cls: 'bg-ink-3 text-white border-ink-2 ring-2 ring-line-strong' };
    default:
      return { label: 'Unclassified', glyph: '·', cls: 'bg-line text-ink-2 border-line-strong' };
  }
}

export default function EventRepliesPage() {
  const params = useParams<{ id: string }>();
  const eventId = Number(params.id);
  const [rows, setRows] = useState<Row[]>([]);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [filter, setFilter] = useState<'all' | 'yes' | 'no' | 'maybe' | 'unclear'>('all');
  const [showResolved, setShowResolved] = useState(false);
  const [lastCheck, setLastCheck] = useState<LastCheck | null>(null);
  const [isPending, start] = useTransition();

  const refresh = () =>
    start(async () => {
      const [r, lc] = await Promise.all([
        listRepliesForEvent(eventId, showResolved),
        latestReplyCheck(),
      ]);
      setRows(r);
      setLastCheck(lc);
    });

  const checkInFlight = lastCheck?.status === 'queued' || lastCheck?.status === 'running';
  const checkNow = () => start(async () => { await triggerReplyCheck(); refresh(); });

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showResolved]);

  const visible = rows.filter((r) => filter === 'all' || r.classification === filter);

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xl font-semibold tracking-tight">Replies</h2>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1 text-xs text-ink-2">
            <input
              type="checkbox"
              checked={showResolved}
              onChange={(e) => setShowResolved(e.target.checked)}
            />
            Show resolved
          </label>
          <button
            onClick={checkNow}
            disabled={checkInFlight}
            className="btn-primary"
          >
            {checkInFlight ? 'Checking…' : 'Check now'}
          </button>
        </div>
      </div>

      {lastCheck ? (
        <p className="text-xs text-ink-2">
          Last check: <strong>{lastCheck.status}</strong> · started {ago(lastCheck.created_at)}
          {lastCheck.finished_at ? ` · finished ${ago(lastCheck.finished_at)}` : ''}
          {lastCheck.last_error ? ` · error: ${lastCheck.last_error.slice(0, 120)}` : ''}
        </p>
      ) : (
        <p className="text-xs text-ink-2">No checks have run yet.</p>
      )}

      <div className="flex gap-2 text-xs">
        {(['all', 'yes', 'no', 'maybe', 'unclear'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`rounded-full px-3 py-1 ${filter === s ? 'bg-ink text-white shadow-raise' : 'bg-line text-ink-2 hover:bg-line-strong'}`}
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
              className={`card p-4 space-y-2 ${r.resolved ? 'opacity-70' : ''}`}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`flex flex-none flex-col items-center justify-center rounded-sm border px-2 py-1 text-xs font-semibold ${cv.cls}`}
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
                    <span className="badge badge-neutral">{r.response_status ?? 'pending'}</span>
                    {r.resolved && <span className="badge badge-neutral">resolved</span>}
                  </div>
                </div>
                <button
                  onClick={() => start(async () => { await setEventReplyResolved({ reply_id: r.reply_id, resolved: !r.resolved }); refresh(); })}
                  disabled={isPending}
                  className="btn btn-sm flex-none"
                >
                  {r.resolved ? 'Reopen' : 'Mark resolved'}
                </button>
              </div>
              {r.summary && <p className="text-xs italic text-ink-2">{r.summary}</p>}

              <div className="card-quiet p-4 text-sm">
                <p className="text-xs text-ink-3">Their reply:</p>
                <p className="whitespace-pre-wrap">{r.reply_text}</p>
              </div>

              <textarea
                className="field h-20 w-full"
                value={editValue}
                onChange={(e) => setEdits({ ...edits, [r.reply_id]: e.target.value })}
                placeholder="(no draft yet)"
              />

              <div className="flex flex-wrap gap-2 text-xs">
                {r.response_status === 'prefilled' ? (
                  <>
                    <span className="badge badge-amber">
                      ✋ Pre-filled in WhatsApp. Click send there, then:
                    </span>
                    <button
                      onClick={() => start(async () => { await markResponseSent({ reply_id: r.reply_id }); refresh(); })}
                      className="btn-primary btn-sm bg-emerald-600 hover:bg-emerald-700"
                    >
                      Mark sent
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      disabled={!dirty || isPending || r.response_status === 'sent'}
                      onClick={() => start(async () => { await editResponse({ reply_id: r.reply_id, response_draft: editValue }); refresh(); })}
                      className="btn btn-sm"
                    >
                      Save edits
                    </button>
                    <button
                      disabled={isPending || !r.response_draft || r.response_status === 'approved' || r.response_status === 'sent'}
                      onClick={() => start(async () => { await approveResponse({ reply_id: r.reply_id }); refresh(); })}
                      className="btn-primary btn-sm bg-emerald-600 hover:bg-emerald-700"
                    >
                      Approve &amp; send
                    </button>
                    <button
                      disabled={isPending || r.response_status === 'sent'}
                      onClick={() => start(async () => { await skipResponse({ reply_id: r.reply_id }); refresh(); })}
                      className="btn btn-sm"
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
                      className="btn btn-sm"
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
