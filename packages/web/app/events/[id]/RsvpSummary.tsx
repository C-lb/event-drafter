'use client';

import { useState } from 'react';
import type { RsvpSummary as RsvpSummaryData } from './actions';
import { CopyNamesButton } from './CopyNamesButton';

type TabKey = 'yes' | 'no' | 'maybe' | 'unclear' | 'no_reply_yet';

const TABS: { key: TabKey; label: string; accent: string; badge: string; active: string }[] = [
  { key: 'yes', label: 'Yes', accent: 'text-emerald-700', badge: 'badge-green', active: 'bg-emerald-600 text-white' },
  { key: 'no', label: 'No', accent: 'text-red-700', badge: 'badge-red', active: 'bg-red-600 text-white' },
  { key: 'maybe', label: 'Maybe', accent: 'text-amber-700', badge: 'badge-amber', active: 'bg-amber-600 text-white' },
  { key: 'unclear', label: 'Unclear', accent: 'text-ink-2', badge: 'badge-neutral', active: 'bg-ink text-white shadow-raise' },
  { key: 'no_reply_yet', label: 'No reply yet', accent: 'text-ink-3', badge: 'badge-neutral', active: 'bg-ink text-white shadow-raise' },
];

export function RsvpSummarySection({ data }: { data: RsvpSummaryData }) {
  const counts: Record<TabKey, number> = {
    yes: data.yes.length,
    no: data.no.length,
    maybe: data.maybe.length,
    unclear: data.unclear.length,
    no_reply_yet: data.no_reply_yet.length,
  };
  const total = counts.yes + counts.no + counts.maybe + counts.unclear + counts.no_reply_yet;

  // Open on the first category that has anyone in it, else Yes.
  const firstNonEmpty = (TABS.find((t) => counts[t.key] > 0)?.key) ?? 'yes';
  const [active, setActive] = useState<TabKey>(firstNonEmpty);

  const names = data[active].map((r) => r.contact_name);
  const activeMeta = TABS.find((t) => t.key === active)!;

  return (
    <section className="card p-5 space-y-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-base font-semibold text-ink">RSVP summary</h3>
        <span className="text-xs text-ink-3">{total} sent invitations</span>
      </div>

      {/* Segmented toggle — one category visible at a time. */}
      <div className="flex flex-wrap gap-1.5 text-xs">
        {TABS.map((t) => {
          const isActive = t.key === active;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActive(t.key)}
              aria-pressed={isActive}
              className={`rounded-full px-3 py-1 transition ${isActive ? t.active : `${t.badge} hover:opacity-80`}`}
            >
              {t.label} ({counts[t.key]})
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between">
        <p className={`eyebrow ${activeMeta.accent}`}>
          {activeMeta.label} · {names.length}
        </p>
        <CopyNamesButton names={names} label={`${activeMeta.label.toLowerCase()} list`} />
      </div>

      {/* Spreadsheet-style numbered rows. */}
      {names.length === 0 ? (
        <p className="rounded-sm border border-line bg-surface-2 p-4 text-xs text-ink-3">
          Nobody here yet.
        </p>
      ) : (
        <ol className="overflow-hidden rounded-sm border border-line">
          {names.map((name, i) => (
            <li
              key={`${active}-${i}`}
              className={`flex items-baseline gap-3 px-3 py-2 text-sm ${i % 2 ? 'bg-surface-2' : 'bg-surface'} ${
                i > 0 ? 'border-t border-line' : ''
              }`}
            >
              <span className="w-8 flex-none text-right font-mono text-xs tabular-nums text-ink-3">{i + 1}</span>
              <span className="min-w-0 truncate text-ink">{name}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
