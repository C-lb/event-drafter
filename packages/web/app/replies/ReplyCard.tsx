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
import { setReplyResolved, setReplyClassification, reactToReply, autoDraftAndSend } from './actions';
import { useQueue } from './QueueProvider';
import { useDeferredSend } from './useDeferredSend';

// Flat semantic tints, house style: a soft tinted fill + hairline ring, never a
// saturated block. Colour carries meaning (yes/no/maybe), it doesn't decorate.
const CLASSIFY_OPTIONS = [
  { value: 'yes', label: 'Yes', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' },
  { value: 'no', label: 'No', cls: 'bg-red-50 text-red-700 ring-red-600/20' },
  { value: 'maybe', label: 'Maybe', cls: 'bg-amber-50 text-amber-700 ring-amber-600/25' },
  { value: 'unclear', label: 'Unclear', cls: 'bg-line text-ink-2 ring-line-strong' },
] as const;

// The two reactions offered on the compact card. Kept in sync with the
// server's REACTION_EMOJIS (@event-drafter/core); hardcoded here so the client
// bundle does not pull the core package in.
const REACTION_CHOICES = ['\u{1F44D}', '❤️'] as const; // 👍  ❤️

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

/** The anti-vibecoded "Mark it as" chips: flat semantic tints, 1px inset ring,
 *  four states (default / hover / selected / disabled). Shared by the compact
 *  and expanded cards so the styling lives in one place. */
function ClassifyOptions({
  current,
  disabled,
  onPick,
}: {
  current: string | null;
  disabled: boolean;
  onPick: (value: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-1">
      {CLASSIFY_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          disabled={disabled}
          onClick={() => onPick(opt.value)}
          className={`rounded-sm px-2 py-1 text-xs ring-1 ring-inset transition disabled:opacity-50 ${opt.cls} ${
            current === opt.value ? 'font-semibold ring-2' : 'font-medium hover:ring-2'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/** Shown when a reply's thread grew: flags that they texted again and surfaces
 *  what they had said before, so the operator keeps the context of the switch. */
function RepliedAgainNote({ prior }: { prior: string | null }) {
  if (!prior) return null;
  return (
    <div className="space-y-1">
      <span className="badge badge-amber">Replied again</span>
      <p className="rounded-sm bg-surface-2 px-2.5 py-1.5 text-xs text-ink-3">
        <span className="font-medium text-ink-2">Earlier:</span> {prior}
      </p>
    </div>
  );
}

export interface ReplyRow {
  reply_id: number;
  invite_id: number;
  event_id: number;
  event_name: string;
  classification: string | null;
  confidence: number | null;
  summary: string | null;
  classification_source: string | null;
  reply_text: string;
  prior_reply_text: string | null;
  response_draft: string | null;
  response_status: string | null;
  response_sent_at: Date | null;
  reaction_emoji: string | null;
  reaction_status: string | null;
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
  // A clear yes/no needs no drafted reply: it collapses to a compact card whose
  // only action is a private follow-up. maybe/unclear keep the full preview.
  const isMarkedYesNo = r.classification === 'yes' || r.classification === 'no';
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
      if (isMarkedYesNo) return; // compact card: no send action to trigger
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
  }, [r.reply_id, status, canApprove, terminal, isMarkedYesNo]);

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
      <li className="card-quiet flex items-center justify-between px-4 py-3 text-sm text-ink-2">
        <span>{label}</span>
        {send.state.phase === 'sending' && (
          <button onClick={undoSend} className="btn btn-sm">
            Undo
          </button>
        )}
      </li>
    );
  }

  // ---- Compact render: a clear yes/no needs no reply preview. ----
  // Show who it is, the marked status, and one action: follow up privately.
  if (isMarkedYesNo) {
    const yes = r.classification === 'yes';
    const reclassify = (value: string) =>
      start(async () => {
        await setReplyClassification({ reply_id: r.reply_id, classification: value });
        setPickerOpen(false);
        refresh();
      });
    const reacting = r.reaction_status === 'pending' || r.reaction_status === 'sending';
    const reactFailed = r.reaction_status === 'failed';
    const react = (emoji: string) =>
      start(async () => {
        await reactToReply({ reply_id: r.reply_id, emoji });
        refresh();
      });
    // Auto-draft-and-send is in flight while the response works through
    // sending -> approved -> prefilled in the worker.
    const responding =
      r.response_status === 'sending' ||
      r.response_status === 'approved' ||
      r.response_status === 'prefilled';
    const autoSend = () =>
      start(async () => {
        await autoDraftAndSend({ reply_id: r.reply_id });
        refresh();
      });
    return (
      <li
        className={`card flex flex-wrap items-start gap-x-4 gap-y-3 p-4 text-sm ${
          highlighted ? 'ring-2 ring-accent/40' : ''
        } ${r.resolved ? 'opacity-70' : ''}`}
      >
        <span className={`badge mt-0.5 flex-none ${yes ? 'badge-green' : 'badge-red'}`}>
          {yes ? 'Marked yes' : 'Marked no'}
        </span>

        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-baseline gap-2">
            <strong className="truncate">{r.contact_name}</strong>
            <Link
              href={`/events/${r.event_id}/replies`}
              className="text-xs font-medium text-accent hover:text-accent-hover"
            >
              {r.event_name}
            </Link>
          </div>
          <RepliedAgainNote prior={r.prior_reply_text} />
          {/* The reply that settled it, so the operator sees why it's a yes/no. */}
          <p className="rounded-sm bg-surface-2 px-2.5 py-1.5 text-xs text-ink">
            {r.reply_text}
          </p>
        </div>

        <div className="flex flex-none flex-wrap items-center gap-2">
          <div className="flex items-center gap-1" title="React on their reply in WhatsApp">
            {REACTION_CHOICES.map((emoji) => {
              const sent = r.reaction_status === 'sent' && r.reaction_emoji === emoji;
              return (
                <button
                  key={emoji}
                  onClick={() => react(emoji)}
                  disabled={isPending || reacting}
                  aria-pressed={sent}
                  title={sent ? `Reacted ${emoji}` : `React ${emoji}`}
                  className={`btn btn-sm px-2 text-base leading-none ${sent ? 'ring-2 ring-accent/40' : ''}`}
                >
                  {emoji}
                </button>
              );
            })}
            {reacting && <span className="text-xs text-ink-3">Reacting…</span>}
            {reactFailed && <span className="text-xs text-red-600">Could not react</span>}
          </div>

          <button
            onClick={autoSend}
            disabled={isPending || responding}
            className="btn btn-sm"
            title="Draft a reply and send it to them now"
          >
            {responding ? 'Sending reply…' : 'Auto-draft and send'}
          </button>

          <Link href={`/events/${r.event_id}/follow-up?invite=${r.invite_id}`} className="btn btn-sm">
            Follow up privately
          </Link>
          <div className="relative">
            <button
              onClick={() => setPickerOpen((o) => !o)}
              disabled={isPending}
              className="btn btn-sm"
              title="Change how this reply is classified"
            >
              Mark it as {pickerOpen ? '▴' : '▾'}
            </button>
            {pickerOpen && (
              <div className="absolute right-0 z-10 mt-1 w-40 rounded-sm border border-line bg-surface p-1 shadow-pop">
                <ClassifyOptions current={r.classification} disabled={isPending} onPick={reclassify} />
              </div>
            )}
          </div>
        </div>
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
    stateLabel = 'resolved'; stateCls = 'badge-neutral';
  } else if (status === 'pending' && hadPriorResponse && !inboundAfterReply) {
    stateLabel = 'awaiting their reply'; stateCls = 'badge-neutral';
  } else if (status === 'pending' && inboundAfterReply) {
    stateLabel = 'they replied again'; stateCls = 'badge-amber';
  } else if (status === 'pending') {
    stateLabel = 'needs review'; stateCls = 'badge-blue';
  } else {
    stateLabel = status; stateCls = 'badge-neutral';
  }

  return (
    <li
      className={`card p-4 text-sm space-y-3 ${
        highlighted ? 'ring-2 ring-accent/40' : ''
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
            <Link href={`/events/${r.event_id}/replies`} className="text-xs font-medium text-accent hover:text-accent-hover">
              {r.event_name}
            </Link>
            <span className={`badge ${stateCls}`}>{stateLabel}</span>
          </div>
          {r.summary && <p className="text-xs italic text-ink-2">{r.summary}</p>}
          <p className="text-xs text-ink-3" suppressHydrationWarning>
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
            className="btn btn-sm w-full"
          >
            {r.resolved ? 'Reopen' : 'Mark resolved'}
          </button>

          <button
            onClick={() => setPickerOpen((o) => !o)}
            disabled={isPending}
            className="btn btn-sm w-full"
            title="Override the classification regardless of the LLM's read"
          >
            Mark it as {pickerOpen ? '▴' : '▾'}
          </button>

          {pickerOpen && (
            <ClassifyOptions
              current={r.classification}
              disabled={isPending}
              onPick={(value) =>
                start(async () => {
                  await setReplyClassification({ reply_id: r.reply_id, classification: value });
                  setPickerOpen(false);
                  refresh();
                })
              }
            />
          )}
        </div>
      </div>

      <RepliedAgainNote prior={r.prior_reply_text} />

      <div className="rounded-sm bg-surface-2 p-3 text-sm">
        <p className="eyebrow mb-1">Their reply</p>
        <p className="whitespace-pre-wrap">{r.reply_text}</p>
      </div>

      <textarea
        ref={textareaRef}
        className="field h-20 resize-y"
        value={editValue}
        onChange={(e) => setEdit(e.target.value)}
        placeholder="(no draft yet)"
      />

      {send.state.phase === 'error' && (
        <p className="rounded-sm bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-inset ring-red-600/20">
          Send failed: {send.state.message}. Try Approve and send again.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {status === 'prefilled' ? (
          <>
            <span className="badge badge-amber">
              Pre-filled in WhatsApp. Click send there, then:
            </span>
            <button
              onClick={() => doCollapse('sentManual', () => markResponseSent({ reply_id: r.reply_id }))}
              className="btn-primary btn-sm bg-emerald-600 hover:bg-emerald-700"
              style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18), 0 12px 26px -16px rgba(5,150,105,0.6)' }}
            >
              Mark sent
            </button>
          </>
        ) : (
          <>
            <button
              disabled={isPending || !canApprove}
              onClick={approveAndSend}
              className="btn-primary bg-emerald-600 hover:bg-emerald-700"
              style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18), 0 12px 26px -16px rgba(5,150,105,0.6)' }}
            >
              Approve and send
            </button>
            <button
              disabled={!dirty || isPending || status === 'sent'}
              onClick={() => start(async () => { await editResponse({ reply_id: r.reply_id, response_draft: editValue }); setEdit(null); refresh(); })}
              className="btn btn-sm"
            >
              Save edits
            </button>
            <button
              disabled={isPending || status === 'sent'}
              onClick={() => doCollapse('skipped', () => skipResponse({ reply_id: r.reply_id }))}
              className="btn btn-sm"
            >
              Skip
            </button>
            <button
              disabled={isPending || status === 'approved' || status === 'prefilled' || status === 'sent'}
              onClick={() => start(async () => { await regenerateResponse({ reply_id: r.reply_id }); setEdit(null); refresh(); })}
              className="btn btn-sm"
              title="Re-run the LLM to draft a fresh response"
            >
              Regenerate
            </button>
          </>
        )}
      </div>
    </li>
  );
}
