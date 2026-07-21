'use client';

import { useEffect, useState, useTransition } from 'react';
import { useParams } from 'next/navigation';
import {
  listInvitesForEvent,
  editDraft,
  approveDraft,
  approveBatch,
  approveAll,
  skipDraft,
  regenerateDraft,
  clearDraft,
  markSent,
  reprefill,
  resendInvite,
  getAutoSendEnabled,
  setAutoSendEnabled,
  autoDraftEvent,
} from '../actions';
import { RateLimitTimer } from './RateLimitTimer';
import { TemplatePopover } from './TemplatePopover';

type Row = Awaited<ReturnType<typeof listInvitesForEvent>>[number];

export default function QueuePage() {
  const params = useParams<{ id: string }>();
  const eventId = Number(params.id);

  const [rows, setRows] = useState<Row[]>([]);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [isPending, start] = useTransition();
  const [filter, setFilter] = useState<'all' | 'pending' | 'drafted' | 'approved' | 'sending' | 'prefilled' | 'sent' | 'skipped' | 'failed'>('all');

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
  const pendingCount = rows.filter((r) => r.status === 'pending').length;
  const batchSize = Math.min(5, draftedCount);
  const [batchBanner, setBatchBanner] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const autoDraft = () => {
    if (pendingCount === 0) return;
    setBatchBanner(null);
    start(async () => {
      const r = await autoDraftEvent({ event_id: eventId });
      if (!r.ok) { setBatchBanner({ kind: 'err', text: r.error }); return; }
      setBatchBanner({
        kind: 'ok',
        text: r.drafting === 0
          ? 'Nothing to draft. Every contact already has a message or is already being drafted.'
          : `Drafting ${r.drafting} message${r.drafting === 1 ? '' : 's'}. They appear here as the worker finishes (refreshes every 2s).`,
      });
      refresh();
    });
  };

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

  const approveEverything = () => {
    if (draftedCount === 0) return;
    if (!confirm(`Approve all ${draftedCount} drafted invite${draftedCount === 1 ? '' : 's'}? The worker still paces the actual sends per the rate limiter.`)) return;
    setBatchBanner(null);
    start(async () => {
      try {
        const r = await approveAll({ event_id: eventId });
        setBatchBanner({ kind: 'ok', text: `Approved all ${r.approved} draft${r.approved === 1 ? '' : 's'}. Worker will pre-fill them on its rate-limited cadence (CONTEXT.md).` });
        refresh();
      } catch (e) {
        setBatchBanner({ kind: 'err', text: e instanceof Error ? e.message : 'unknown' });
      }
    });
  };

  return (
    <section className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-2xl font-semibold tracking-tight">Review queue</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={autoDraft}
            disabled={isPending || pendingCount === 0}
            className="btn"
            title={
              pendingCount === 0
                ? 'No contacts are waiting for a message.'
                : `Have the assistant draft messages for the ${pendingCount} contact${pendingCount === 1 ? '' : 's'} with no message yet.`
            }
          >
            Auto-draft{pendingCount ? ` (${pendingCount})` : ''}
          </button>
          <TemplatePopover eventId={eventId} onApplied={refresh} />
          <button
            onClick={approveNext}
            disabled={isPending || batchSize === 0}
            className="btn-primary bg-emerald-600 hover:bg-emerald-700"
            title={
              batchSize === 0
                ? 'No drafted invites to approve.'
                : `Approves the next ${batchSize} drafted invite${batchSize === 1 ? '' : 's'} (oldest first). Send cadence still applies per CONTEXT.md.`
            }
          >
            Approve next {batchSize || 5}
          </button>
          <button
            onClick={approveEverything}
            disabled={isPending || draftedCount === 0}
            className="btn-primary bg-emerald-600 hover:bg-emerald-700"
            title={
              draftedCount === 0
                ? 'No drafted invites to approve.'
                : `Approves all ${draftedCount} drafted invite${draftedCount === 1 ? '' : 's'}. Send cadence still applies per CONTEXT.md.`
            }
          >
            Approve all{draftedCount ? ` (${draftedCount})` : ''}
          </button>
        </div>
      </div>

      {batchBanner && (
        <div
          className={
            batchBanner.kind === 'ok'
              ? 'rounded-card bg-emerald-50 p-4 text-sm text-emerald-700 ring-1 ring-inset ring-emerald-600/20'
              : 'rounded-card bg-red-50 p-4 text-sm text-red-700 ring-1 ring-inset ring-red-600/20'
          }
        >
          {batchBanner.text}
        </div>
      )}

      <RateLimitTimer />

      <div
        className={`flex items-center justify-between gap-3 rounded-card p-4 text-sm ${
          autoSend ? 'bg-amber-50 text-amber-900 ring-1 ring-inset ring-amber-600/25' : 'card-quiet text-ink-2'
        }`}
      >
        <div>
          <strong>Send mode:</strong>{' '}
          {autoSend === null
            ? '…'
            : autoSend
            ? 'Auto-send on. Worker clicks the WhatsApp send button after pre-fill.'
            : 'Manual. Worker pre-fills only; you click send in WhatsApp.'}{' '}
          {autoSend && (
            <span className="opacity-80">
              Rate limiter still paces sends (gap, batch cool-downs, and hourly cap).
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={toggleAutoSend}
          disabled={isPending || autoSend === null}
          className="btn btn-sm"
        >
          {autoSend ? 'Switch to manual' : 'Enable auto-send'}
        </button>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        {(['all', 'pending', 'drafted', 'approved', 'sending', 'prefilled', 'sent', 'skipped', 'failed'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`rounded-full px-3 py-1 ${filter === s ? 'bg-ink text-white shadow-raise' : 'bg-line text-ink-2 hover:bg-line-strong'}`}
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
            <li key={r.invite_id} className="card p-4 space-y-2">
              <div className="flex items-baseline justify-between">
                <p className="font-medium">{r.first_name}{r.last_name ? ' ' + r.last_name : ''} <span className="text-xs text-ink-3">{r.phone_e164}</span></p>
                <span className="flex items-center gap-1.5 text-xs">
                  {r.status === 'sent' && (
                    r.sent_confirmed_at ? (
                      <span className="badge badge-green" title={`Confirmed on WhatsApp at ${new Date(r.sent_confirmed_at).toLocaleString()}`}>
                        ✓ Confirmed on WhatsApp
                      </span>
                    ) : (
                      <span className="badge badge-amber" title="Marked sent, but delivery was never verified against WhatsApp. Check the chat or use Resend.">
                        ⚠ Not verified
                      </span>
                    )
                  )}
                  <span className="badge badge-neutral">{r.status}</span>
                </span>
              </div>
              {r.remarks && <p className="text-xs text-ink-2 italic">remarks: {r.remarks}</p>}

              {r.status === 'pending' ? (
                <div className="rounded-sm bg-surface-2 px-3 py-2.5">
                  <p className="text-xs font-medium text-ink-2">No message yet</p>
                  <p className="mt-0.5 text-xs text-ink-3">
                    Use Auto-draft above to generate one, or apply your own template. Drafts appear here automatically.
                  </p>
                </div>
              ) : (
                <>
                  <textarea
                    className="field h-24 w-full"
                    value={editValue}
                    onChange={(e) => setEdits({ ...edits, [r.invite_id]: e.target.value })}
                  />
                  <div className="flex flex-wrap gap-2 text-xs">
                    {r.status === 'prefilled' ? (
                      <>
                        <span className="badge badge-amber">
                          ✋ Pre-filled in WhatsApp. Click send there, then:
                        </span>
                        <button
                          disabled={isPending}
                          onClick={() => start(async () => { await markSent({ invite_id: r.invite_id }); refresh(); })}
                          className="btn-primary btn-sm bg-emerald-600 hover:bg-emerald-700"
                        >
                          Mark sent
                        </button>
                        <button
                          disabled={isPending}
                          onClick={() => start(async () => { await reprefill({ invite_id: r.invite_id }); refresh(); })}
                          className="btn btn-sm"
                        >
                          Re-prefill
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          disabled={!dirty || isPending || r.status === 'sending' || r.status === 'sent'}
                          onClick={() => start(async () => { await editDraft({ invite_id: r.invite_id, draft_text: editValue }); refresh(); })}
                          className="btn btn-sm"
                        >
                          Save edits
                        </button>
                        <button
                          disabled={isPending || r.status === 'approved' || r.status === 'sending' || r.status === 'sent'}
                          onClick={() => start(async () => { await approveDraft({ invite_id: r.invite_id }); refresh(); })}
                          className="btn-primary btn-sm bg-emerald-600 hover:bg-emerald-700"
                        >
                          Approve
                        </button>
                        <button
                          disabled={isPending || r.status === 'sending' || r.status === 'sent'}
                          onClick={() => start(async () => { await skipDraft({ invite_id: r.invite_id }); refresh(); })}
                          className="btn btn-sm"
                        >
                          Skip
                        </button>
                        <button
                          disabled={isPending || r.status === 'sending' || r.status === 'sent'}
                          onClick={() => start(async () => { await regenerateDraft({ invite_id: r.invite_id }); refresh(); })}
                          className="btn btn-sm"
                        >
                          Regenerate
                        </button>
                        <button
                          disabled={isPending || r.status === 'sending' || r.status === 'sent'}
                          onClick={() => {
                            if (!window.confirm(`Clear the draft for ${r.first_name}? This wipes the current message back to no message yet.`)) return;
                            start(async () => { await clearDraft({ invite_id: r.invite_id }); refresh(); });
                          }}
                          className="btn-ghost btn-sm text-red-700"
                        >
                          Clear draft
                        </button>
                        {(r.status === 'sent' || r.status === 'failed') && (
                          <button
                            disabled={isPending}
                            onClick={() => start(async () => { await resendInvite({ invite_id: r.invite_id }); refresh(); })}
                            className="btn btn-sm"
                          >
                            Resend
                          </button>
                        )}
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
