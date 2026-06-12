'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  approveResponse,
  skipResponse,
  markResponseSent,
  editResponse,
  regenerateResponse,
} from '../events/[id]/actions';
import { setReplyResolved } from './actions';

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
  const [isPending, start] = useTransition();
  const [edit, setEdit] = useState<string | null>(null);

  const editValue = edit ?? r.response_draft ?? '';
  const dirty = (r.response_draft ?? '') !== editValue;
  const cv = classificationVisual(r.classification);
  const status = r.response_status ?? 'pending';

  const hadPriorResponse = !!r.response_sent_at;
  const inboundAfterReply =
    hadPriorResponse &&
    r.wa_sent_at &&
    r.response_sent_at &&
    new Date(r.wa_sent_at as unknown as Date).getTime() >
      new Date(r.response_sent_at as unknown as Date).getTime();

  let stateLabel: string;
  let stateCls: string;
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

  const refresh = () => router.refresh();

  return (
    <li
      className={`rounded border bg-white p-3 text-sm ${
        r.resolved ? 'border-neutral-200 opacity-70' : 'border-neutral-200'
      } space-y-2`}
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

        <div className="flex-1 space-y-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <strong>{r.contact_name}</strong>
            <Link
              href={`/events/${r.event_id}/replies`}
              className="text-xs text-blue-700 underline"
            >
              {r.event_name}
            </Link>
            <span className={`rounded px-2 py-0.5 text-xs ${stateCls}`}>{stateLabel}</span>
          </div>
          {r.summary && <p className="text-xs italic text-neutral-600">{r.summary}</p>}
          <p className="text-xs text-neutral-500">
            {r.detected_at ? new Date(r.detected_at as unknown as Date).toLocaleString() : ''}
            {r.resolved && r.resolved_at ? ` · resolved ${ago(r.resolved_at as unknown as Date)}` : ''}
          </p>
        </div>

        <button
          onClick={() =>
            start(async () => {
              await setReplyResolved({ reply_id: r.reply_id, resolved: !r.resolved });
              refresh();
            })
          }
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

      <div className="rounded bg-neutral-50 p-2 text-sm">
        <p className="text-xs text-neutral-500">Their reply:</p>
        <p className="whitespace-pre-wrap">{r.reply_text}</p>
      </div>

      <textarea
        className="h-20 w-full rounded border border-neutral-300 p-2 text-sm"
        value={editValue}
        onChange={(e) => setEdit(e.target.value)}
        placeholder="(no draft yet)"
      />

      <div className="flex flex-wrap gap-2 text-xs">
        {status === 'prefilled' ? (
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
              disabled={!dirty || isPending || status === 'sent'}
              onClick={() =>
                start(async () => {
                  await editResponse({ reply_id: r.reply_id, response_draft: editValue });
                  setEdit(null);
                  refresh();
                })
              }
              className="rounded border border-neutral-300 px-2 py-1 disabled:opacity-50"
            >
              Save edits
            </button>
            <button
              disabled={isPending || !editValue.trim() || status === 'approved' || status === 'sent'}
              onClick={() => start(async () => { await approveResponse({ reply_id: r.reply_id }); refresh(); })}
              className="rounded bg-green-600 px-2 py-1 text-white disabled:opacity-50"
            >
              Approve &amp; send
            </button>
            <button
              disabled={isPending || status === 'sent'}
              onClick={() => start(async () => { await skipResponse({ reply_id: r.reply_id }); refresh(); })}
              className="rounded border border-neutral-300 px-2 py-1 disabled:opacity-50"
            >
              Skip
            </button>
            <button
              disabled={
                isPending ||
                status === 'approved' ||
                status === 'prefilled' ||
                status === 'sent'
              }
              onClick={() =>
                start(async () => {
                  await regenerateResponse({ reply_id: r.reply_id });
                  setEdit(null);
                  refresh();
                })
              }
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
}
