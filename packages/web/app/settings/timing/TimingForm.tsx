'use client';

import { useState } from 'react';
import type { TimingConfig } from '@event-drafter/core/settings';
import { saveTiming } from './actions';

type SavePhase = 'idle' | 'saving' | 'confirmed';

export function TimingForm({ initial }: { initial: TimingConfig }) {
  const [followUpDelay, setFollowUpDelay] = useState(String(initial.follow_up_delay_days));
  const [lookback, setLookback] = useState(String(initial.reply_lookback_days));
  const [times, setTimes] = useState<string[]>(initial.reply_check_times);
  const [phase, setPhase] = useState<SavePhase>('idle');
  const [error, setError] = useState<string | null>(null);

  const updateTime = (i: number, value: string) =>
    setTimes((prev) => prev.map((t, j) => (j === i ? value : t)));
  const addTime = () => setTimes((prev) => [...prev, '09:00']);
  const removeTime = (i: number) => setTimes((prev) => prev.filter((_, j) => j !== i));

  async function handleSave() {
    setPhase('saving');
    setError(null);
    try {
      const res = await saveTiming({
        follow_up_delay_days: Number(followUpDelay),
        reply_lookback_days: Number(lookback),
        reply_check_times: times,
      });
      if (res.ok) {
        setFollowUpDelay(String(res.config.follow_up_delay_days));
        setLookback(String(res.config.reply_lookback_days));
        setTimes(res.config.reply_check_times);
        setPhase('confirmed');
        setTimeout(() => setPhase('idle'), 1600);
      } else {
        setError(res.error);
        setPhase('idle');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
      setPhase('idle');
    }
  }

  const saving = phase === 'saving';
  const confirmed = phase === 'confirmed';

  return (
    <section className="mx-auto max-w-2xl space-y-8">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Timing</h2>
        <p className="mt-1 text-sm text-ink-2">
          When the worker scans for replies and how long it waits before drafting a follow-up. Changes
          apply within a minute, no restart.
        </p>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-ink-1">Reply-check times</legend>
        <p className="text-xs text-ink-3">
          Daily times the worker scans WhatsApp for new replies. Times are in Singapore time (SGT).
        </p>
        <div className="space-y-2">
          {times.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="time"
                className="field w-40"
                value={t}
                onChange={(e) => updateTime(i, e.target.value)}
                aria-label={`Reply-check time ${i + 1}`}
              />
              <button
                type="button"
                onClick={() => removeTime(i)}
                disabled={times.length === 1}
                className="btn-ghost btn-sm text-ink-2 disabled:opacity-40"
                title={times.length === 1 ? 'Keep at least one time.' : 'Remove this time'}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <button type="button" onClick={addTime} className="btn btn-sm">
          Add time
        </button>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-sm font-medium text-ink-1">Delays</legend>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-ink-1" htmlFor="followUpDelay">
              Follow-up delay (days)
            </label>
            <input
              id="followUpDelay"
              type="number"
              min={1}
              max={90}
              className="field w-full"
              value={followUpDelay}
              onChange={(e) => setFollowUpDelay(e.target.value)}
            />
            <p className="mt-1 text-xs text-ink-3">
              Days after an invite is sent, with no reply, before a follow-up is drafted.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink-1" htmlFor="lookback">
              Reply lookback (days)
            </label>
            <input
              id="lookback"
              type="number"
              min={1}
              max={90}
              className="field w-full"
              value={lookback}
              onChange={(e) => setLookback(e.target.value)}
            />
            <p className="mt-1 text-xs text-ink-3">
              How far back a scan looks at sent invites for new replies.
            </p>
          </div>
        </div>
      </fieldset>

      <div className="flex flex-col gap-2">
        <div>
          <button onClick={handleSave} disabled={saving || confirmed} className="btn-primary">
            {saving ? (
              <span className="flex items-center gap-2">
                <span className="spinner" />
                Saving...
              </span>
            ) : confirmed ? (
              <span className="flex items-center gap-2">&#10003; Saved</span>
            ) : (
              'Save'
            )}
          </button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </section>
  );
}
