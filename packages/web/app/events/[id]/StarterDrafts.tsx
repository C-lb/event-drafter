'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { StarterDraft } from '@event-drafter/core/edm-templates';
import { saveDraftOverride, resetDraftOverride } from '../actions';

interface Props {
  eventId: number;
  drafts: StarterDraft[];
  overrides: Partial<Record<string, string>>;
}

interface CardState {
  editing: boolean;
  draft: string;
  saving: boolean;
  copied: boolean;
  error: string | null;
}

function initialCardState(rendered: string, override: string | undefined): CardState {
  return {
    editing: false,
    draft: override ?? rendered,
    saving: false,
    copied: false,
    error: null,
  };
}

export function StarterDrafts({ eventId, drafts, overrides }: Props) {
  const router = useRouter();
  const [states, setStates] = useState<Record<string, CardState>>(() => {
    const out: Record<string, CardState> = {};
    for (const d of drafts) out[d.kind] = initialCardState(d.body, overrides[d.kind]);
    return out;
  });

  const patch = (kind: string, p: Partial<CardState>) =>
    setStates((s) => ({ ...s, [kind]: { ...s[kind]!, ...p } }));

  const startEdit = (d: StarterDraft) => {
    patch(d.kind, { editing: true, draft: overrides[d.kind] ?? d.body, error: null });
  };

  const cancelEdit = (d: StarterDraft) => {
    patch(d.kind, { editing: false, draft: overrides[d.kind] ?? d.body, error: null });
  };

  const save = async (d: StarterDraft) => {
    const s = states[d.kind]!;
    patch(d.kind, { saving: true, error: null });
    const r = await saveDraftOverride({ event_id: eventId, kind: d.kind, body: s.draft });
    if (!r.ok) {
      patch(d.kind, { saving: false, error: r.error });
      return;
    }
    patch(d.kind, { saving: false, editing: false });
    router.refresh();
  };

  const reset = async (d: StarterDraft) => {
    patch(d.kind, { saving: true, error: null });
    const r = await resetDraftOverride({ event_id: eventId, kind: d.kind });
    if (!r.ok) {
      patch(d.kind, { saving: false, error: r.error });
      return;
    }
    patch(d.kind, { saving: false, editing: false, draft: d.body });
    router.refresh();
  };

  const copy = async (d: StarterDraft) => {
    const text = states[d.kind]?.draft ?? d.body;
    try {
      await navigator.clipboard.writeText(text);
      patch(d.kind, { copied: true });
      setTimeout(() => patch(d.kind, { copied: false }), 1800);
    } catch {
      /* clipboard blocked — textarea is selectable as a fallback */
    }
  };

  if (drafts.length === 0) return null;

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">Starter drafts</h3>
        <p className="text-xs text-neutral-500">
          Pre-rendered from the EDM summary. Replace <code>[name]</code> at send time. Click{' '}
          <em>Edit</em> on any card to tweak the wording for this event.
        </p>
      </div>

      {/* Single-column stack: this panel now lives in the right side of the
          event detail page (half-width on wide monitors), so the cards need
          full width each to keep the textareas readable. */}
      <div className="grid gap-3 grid-cols-1">
        {drafts.map((d) => {
          const s = states[d.kind]!;
          const hasOverride = typeof overrides[d.kind] === 'string';
          const visible = s.editing ? s.draft : (overrides[d.kind] ?? d.body);
          const missing = d.missing_facts.length;

          return (
            <article
              key={d.kind}
              className="flex flex-col gap-2 rounded border border-neutral-200 bg-white p-3"
            >
              <header className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-semibold">{d.title}</h4>
                  {hasOverride && !s.editing && (
                    <span className="rounded bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-800">
                      edited
                    </span>
                  )}
                  {s.editing && (
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                      editing
                    </span>
                  )}
                </div>
                <p className="text-xs text-neutral-500">{d.description}</p>
              </header>

              {missing > 0 && !hasOverride && (
                <p className="rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
                  Missing from summary: {d.missing_facts.join(', ')}. Left as placeholders.
                </p>
              )}

              {s.error && (
                <p className="rounded bg-red-50 px-2 py-1 text-[11px] text-red-700">{s.error}</p>
              )}

              <textarea
                readOnly={!s.editing}
                value={visible}
                onChange={(e) => patch(d.kind, { draft: e.target.value })}
                rows={Math.min(20, visible.split('\n').length + 1)}
                className={`flex-1 rounded border p-2 font-mono text-xs leading-relaxed ${
                  s.editing
                    ? 'border-amber-300 bg-white focus:outline-none focus:ring-2 focus:ring-amber-200'
                    : 'border-neutral-200 bg-neutral-50'
                }`}
                onFocus={(e) => { if (!s.editing) e.currentTarget.select(); }}
              />

              <div className="flex flex-wrap items-center gap-2">
                {!s.editing ? (
                  <>
                    <button
                      type="button"
                      onClick={() => copy(d)}
                      className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
                    >
                      {s.copied ? 'Copied ✓' : 'Copy to clipboard'}
                    </button>
                    <button
                      type="button"
                      onClick={() => startEdit(d)}
                      className="rounded border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-50"
                    >
                      Edit
                    </button>
                    {hasOverride && (
                      <button
                        type="button"
                        onClick={() => reset(d)}
                        disabled={s.saving}
                        className="rounded border border-red-200 px-3 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                      >
                        Reset to template
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => save(d)}
                      disabled={s.saving}
                      className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {s.saving ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={() => cancelEdit(d)}
                      disabled={s.saving}
                      className="rounded border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </>
                )}
                <span className="ml-auto text-xs text-neutral-400">{visible.length} chars</span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
