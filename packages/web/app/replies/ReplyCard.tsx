'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  approveResponse,
  skipResponse,
  markResponseSent,
  editResponse,
  regenerateResponse,
} from '../events/[id]/actions';
import { setReplyResolved, setReplyClassification } from './actions';
import { useQueue } from './QueueProvider';
import { useDeferredSend } from './useDeferredSend';

const CLASSIFY_OPTIONS = [
  { value: 'yes', label: 'Yes', cls: 'bg-green-600 text-white border-green-700' },
  { value: 'no', label: 'No', cls: 'bg-red-600 text-white border-red-700' },
  { value: 'maybe', label: 'Maybe', cls: 'bg-amber-500 text-white border-amber-600' },
  { value: 'unclear', label: 'Unclear', cls: 'bg-neutral-500 text-white border-neutral-600' },
] as const;

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
    case 'yes': return { label: 'YES', glyph: '✓', cls: 'bg-green-600 text-white border-green-700 ring-2 ring-green-200' };
    case 'no': return { label: 'NO', glyph: '✕', cls: 'bg-red-600 text-white border-red-700 ring-2 ring-red-200' };
    case 'maybe': return { label: 'MAYBE', glyph: '?', cls: 'bg-amber-500 text-white border-amber-600 ring-2 ring-amber-200' };
    case 'unclear': return { label: 'UNCLEAR', glyph: '…', cls: 'bg-neutral-500 text-white border-neutral-600 ring-2 ring-neutral-200' };
    default: return { label: 'UNCLASSIFIED', glyph: '·', cls: 'bg-neutral-200 text-neutral-700 border-neutral-300' };
  }
}

export interface ReplyRow {
  reply_id: number;
  event_id: number;
  event_name: string;
  classification: string | null;
  confidence: number | null;
  summary: string | null;
  classification_source: string | null;
  reply_text: string;
  response_draft: string | null;
  response_status: string | null;
  response_sent_at: Date | null;
  wa_sent_at: Date | null;
  detected_at: Date | null;
  resolved: boolean;
  resolved_at: Date | null;
  contact_name: string;
}

export function ReplyCard({ r }: { r: ReplyRow }) {
  const router = useRouter();
  const queue = useQueue();
  const [isPending, start] = useTransition();
  const [edit, setEdit] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<null | 'skipped' | 'resolved' | 'sentManual'>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const editValue = edit ?? r.response_draft ?? '';
  const dirty = (r.response_draft ?? '') !== editValue;
  const cv = classificationVisual(r.classification);
  const status = r.response_status ?? 'pending';
  const refresh = () => router.refresh();

  const canApprove = !!editValue.trim() && status !== 'approved' && status !== 'sent';

  const send = useDeferredSend(async () => {
    if (dirty) {
      await editResponse({ reply_id: r.reply_id, response_draft: editValue });
    }
    await approveResponse({ reply_id: r.reply_id });
    queue.removePending(r.reply_id);
    refresh();
  });

  // A card is terminal once it has collapsed or a send is in flight/done.
  const terminal =
    collapsed !== null || send.state.phase === 'sending' || send.state.phase === 'sent';

  // Auto-advance after an action lives in QueueProvider's Enter handler, which
  // reads each card's isTerminal(); the card itself does not push the highlight.

  const approveAndSend = () => {
    queue.addPending(r.reply_id);
    send.send();
  };

  const undoSend = () => {
    send.undo();
    queue.removePending(r.reply_id);
  };

  const doCollapse = (kind: 'skipped' | 'resolved' | 'sentManual', action: () => Promise<unknown>) => {
    start(async () => {
      await action();
      setCollapsed(kind);
      refresh();
    });
  };

  // Register keyboard handlers with the queue.
  useEffect(() => {
    const primary = () => {
      if (status === 'prefilled') {
        doCollapse('sentManual', () => markResponseSent({ reply_id: r.reply_id }));
      } else if (canApprove) {
        approveAndSend();
      }
    };
    const focusEditor = () => textareaRef.current?.focus();
    const isTerminal = () => terminal;
    return queue.registerCard(r.reply_id, { primary, focusEditor, isTerminal });
    // re-register when the inputs to these closures change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.reply_id, status, canApprove, terminal]);

  const highlighted = queue.highlightedId === r.reply_id;

  // ---- Collapsed render ----
  if (terminal) {
    let label: string;
    if (send.state.phase === 'sending') label = `✓ sending to ${r.contact_name}…`;
    else if (send.state.phase === 'sent') label = `✓ sent to ${r.contact_name}`;
    else if (collapsed === 'skipped') label = '↷ skipped';
    else if (collapsed === 'resolved') label = '✓ resolved';
    else label = `✓ sent to ${r.contact_name}`;

    return (
      <li className="flex items-center justify-between rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-600">
        <span>{label}</span>
        {send.state.phase === 'sending' && (
          <button
            onClick={undoSend}
            className="rounded border border-neutral-300 bg-white px-2 py-0.5 text-xs font-medium text-blue-700 hover:bg-neutral-50"
          >
            undo
          </button>
        )}
      </li>
    );
  }

  // ---- Expanded render ----
  let stateLabel: string;
  let stateCls: string;
  const hadPriorResponse = !!r.response_sent_at;
  const inboundAfterReply =
    hadPriorResponse &&
    r.wa_sent_at &&
    r.response_sent_at &&
    new Date(r.wa_sent_at as unknown as Date).getTime() >
      new Date(r.response_sent_at as unknown as Date).getTime();
  if (r.resolved) {
    stateLabel = 'resolved'; stateCls = 'bg-neutral-200 text-neutral-600';
  } else if (status === 'pending' && hadPriorResponse && !inboundAfterReply) {
    stateLabel = 'awaiting their reply'; stateCls = 'bg-neutral-100 text-neutral-600';
  } else if (status === 'pending' && inboundAfterReply) {
    stateLabel = 'they replied again'; stateCls = 'bg-amber-100 text-amber-800';
  } else if (status === 'pending') {
    stateLabel = 'needs review'; stateCls = 'bg-blue-100 text-blue-800';
  } else {
    stateLabel = status; stateCls = 'bg-neutral-100 text-neutral-600';
  }

  return (
    <li
      className={`rounded border bg-white p-3 text-sm space-y-2 ${
        highlighted ? 'border-blue-400 ring-2 ring-blue-200' : 'border-neutral-200'
      } ${r.resolved ? 'opacity-70' : ''}`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`flex flex-none flex-col items-center justify-center rounded-md border px-2 py-1 text-xs font-semibold ${cv.cls}`}
          title={`Classification: ${cv.label}`}
        >
          <span className="text-base leading-none">{cv.glyph}</span>
          <span className="mt-0.5 leading-none tracking-wide">{cv.label}</span>
          {r.classification_source === 'manual' ? (
            <span className="mt-0.5 text-[10px] font-normal opacity-90" title="Classification set by operator">
              ✎ manual
            </span>
          ) : r.classification_source === 'reaction' ? (
            <span className="mt-0.5 text-[10px] font-normal opacity-90" title="Set from a WhatsApp reaction">
              ⚡ reaction
            </span>
          ) : (
            r.confidence !== null && r.confidence !== undefined && (
              <span className="mt-0.5 text-[10px] font-normal opacity-90">
                {Math.round(r.confidence * 100)}%
              </span>
            )
          )}
        </div>

        <div className="flex-1 space-y-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <strong>{r.contact_name}</strong>
            <Link href={`/events/${r.event_id}/replies`} className="text-xs text-blue-700 underline">
              {r.event_name}
            </Link>
            <span className={`rounded px-2 py-0.5 text-xs ${stateCls}`}>{stateLabel}</span>
          </div>
          {r.summary && <p className="text-xs italic text-neutral-600">{r.summary}</p>}
          <p className="text-xs text-neutral-500" suppressHydrationWarning>
            {r.detected_at ? new Date(r.detected_at as unknown as Date).toLocaleString() : ''}
            {r.resolved && r.resolved_at ? ` · resolved ${ago(r.resolved_at as unknown as Date)}` : ''}
          </p>
        </div>

        <div className="flex w-28 flex-none flex-col gap-1">
          <button
            onClick={() =>
              r.resolved
                ? start(async () => {
                    await setReplyResolved({ reply_id: r.reply_id, resolved: false });
                    refresh();
                  })
                : doCollapse('resolved', () => setReplyResolved({ reply_id: r.reply_id, resolved: true }))
            }
            disabled={isPending}
            className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
          >
            {r.resolved ? 'Reopen' : 'Mark resolved'}
          </button>

          <button
            onClick={() => setPickerOpen((o) => !o)}
            disabled={isPending}
            className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
            title="Override the classification regardless of the LLM's read"
          >
            Mark it as {pickerOpen ? '▴' : '▾'}
          </button>

          {pickerOpen && (
            <div className="grid grid-cols-2 gap-1">
              {CLASSIFY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  disabled={isPending}
                  onClick={() =>
                    start(async () => {
                      await setReplyClassification({ reply_id: r.reply_id, classification: opt.value });
                      setPickerOpen(false);
                      refresh();
                    })
                  }
                  className={`rounded border px-1.5 py-1 text-xs font-semibold disabled:opacity-50 ${opt.cls} ${
                    r.classification === opt.value ? 'ring-2 ring-neutral-400 ring-offset-1' : 'opacity-90 hover:opacity-100'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rounded bg-neutral-50 p-2 text-sm">
        <p className="text-xs text-neutral-500">Their reply:</p>
        <p className="whitespace-pre-wrap">{r.reply_text}</p>
      </div>

      <textarea
        ref={textareaRef}
        className="h-20 w-full rounded border border-neutral-300 p-2 text-sm"
        value={editValue}
        onChange={(e) => setEdit(e.target.value)}
        placeholder="(no draft yet)"
      />

      {send.state.phase === 'error' && (
        <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">
          Send failed: {send.state.message}. Try Approve &amp; send again.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {status === 'prefilled' ? (
          <>
            <span className="rounded bg-yellow-100 px-2 py-1 text-yellow-800">
              ✋ Pre-filled in WA — click send there, then:
            </span>
            <button
              onClick={() => doCollapse('sentManual', () => markResponseSent({ reply_id: r.reply_id }))}
              className="rounded bg-green-700 px-3 py-1.5 font-medium text-white"
            >
              Mark sent
            </button>
          </>
        ) : (
          <>
            <button
              disabled={isPending || !canApprove}
              onClick={approveAndSend}
              className="rounded bg-green-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-700 disabled:opacity-50"
            >
              ✓ Approve &amp; send
            </button>
            <button
              disabled={!dirty || isPending || status === 'sent'}
              onClick={() => start(async () => { await editResponse({ reply_id: r.reply_id, response_draft: editValue }); setEdit(null); refresh(); })}
              className="rounded border border-neutral-300 px-2 py-1 text-neutral-600 disabled:opacity-50"
            >
              Save edits
            </button>
            <button
              disabled={isPending || status === 'sent'}
              onClick={() => doCollapse('skipped', () => skipResponse({ reply_id: r.reply_id }))}
              className="rounded border border-neutral-300 px-2 py-1 text-neutral-600 disabled:opacity-50"
            >
              Skip
            </button>
            <button
              disabled={isPending || status === 'approved' || status === 'prefilled' || status === 'sent'}
              onClick={() => start(async () => { await regenerateResponse({ reply_id: r.reply_id }); setEdit(null); refresh(); })}
              className="rounded border border-neutral-300 px-2 py-1 text-neutral-600 disabled:opacity-50"
              title="Re-run the LLM to draft a fresh response"
            >
              ↻ Regenerate
            </button>
          </>
        )}
      </div>
    </li>
  );
}
