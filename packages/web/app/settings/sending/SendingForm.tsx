'use client';

import { useState, useRef, useEffect } from 'react';
import { fromMs, toMs, warnings, type RateLimitForm } from '@/lib/rate-limit-form';
import { saveRateLimit } from './actions';

interface RateLimitState {
  delayMs: number | null;
  reason: string | null;
  inBatch: number;
  sentLastHour: number;
  lastSendAtMs: number | null;
}

type SavePhase = 'idle' | 'saving' | 'confirmed';

export function SendingForm({ initial }: { initial: RateLimitForm }) {
  const [form, setForm] = useState<RateLimitForm>(initial);
  const [phase, setPhase] = useState<SavePhase>('idle');
  const [repaced, setRepaced] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [rlState, setRlState] = useState<RateLimitState | null>(null);
  const [highlighted, setHighlighted] = useState(false);
  const prevDelayRef = useRef<number | null | undefined>(undefined);
  const reducedMotion = useRef(
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  );

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch('/api/worker/state');
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const rl: RateLimitState | null = data.rateLimit ?? null;
        setRlState(rl);
        const newDelay = rl?.delayMs ?? null;
        if (
          prevDelayRef.current !== undefined &&
          prevDelayRef.current !== newDelay &&
          !reducedMotion.current
        ) {
          setHighlighted(true);
          setTimeout(() => setHighlighted(false), 600);
        }
        prevDelayRef.current = newDelay;
      } catch {
        // ignore network errors; readout just stays stale
      }
    }

    poll();
    const id = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const w = warnings(form);

  function update(key: keyof RateLimitForm, raw: string) {
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setPhase('saving');
    setSaveError(null);
    setRepaced(null);
    try {
      const ms = toMs(form);
      const res = await saveRateLimit(ms);
      if (res.ok) {
        setRepaced(res.repaced);
        setPhase('confirmed');
        setTimeout(() => setPhase('idle'), 1600);
      } else {
        setSaveError(res.error);
        setPhase('idle');
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Unknown error');
      setPhase('idle');
    }
  }

  const saving = phase === 'saving';
  const confirmed = phase === 'confirmed';

  return (
    <section className="mx-auto max-w-2xl space-y-8">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Sending cadence</h2>
        <p className="mt-1 text-sm text-ink-2">
          Changes apply immediately, no restart. Lower values send faster but raise WhatsApp ban risk.
        </p>
      </div>

      {/* Live next-send readout */}
      <div
        className={`card p-4 text-sm${highlighted ? ' bg-amber-50' : ''}`}
        style={{ transition: 'background-color 0.6s ease' }}
      >
        <p className="mb-1 text-xs font-medium tracking-wide text-ink-3">Live status</p>
        {rlState == null ? (
          <span className="text-ink-3">Connecting...</span>
        ) : rlState.delayMs == null ? (
          <span className="font-medium text-emerald-700">Ready to send now</span>
        ) : (
          <span className="font-medium">
            Next send in {Math.ceil(rlState.delayMs / 1000)}s
            {rlState.reason ? <span className="font-normal text-ink-2"> ({rlState.reason})</span> : null}
          </span>
        )}
        {rlState != null && (
          <p className="mt-0.5 text-ink-3">{rlState.sentLastHour} sent this hour</p>
        )}
      </div>

      <div className="space-y-6">
        <fieldset>
          <legend className="mb-3 text-sm font-medium text-ink-1">Gap between sends</legend>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink-1" htmlFor="minGapSec">
                Min gap (seconds)
              </label>
              <input
                id="minGapSec"
                type="number"
                min={1}
                className="field w-full"
                value={form.minGapSec}
                onChange={(e) => update('minGapSec', e.target.value)}
              />
              {w.minGapSec && <p className="mt-1 text-xs text-amber-700">&#9888; {w.minGapSec}</p>}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink-1" htmlFor="maxGapSec">
                Max gap (seconds)
              </label>
              <input
                id="maxGapSec"
                type="number"
                min={1}
                className="field w-full"
                value={form.maxGapSec}
                onChange={(e) => update('maxGapSec', e.target.value)}
              />
              {w.maxGapSec && <p className="mt-1 text-xs text-amber-700">&#9888; {w.maxGapSec}</p>}
            </div>
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-3 text-sm font-medium text-ink-1">Batch and hourly limits</legend>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink-1" htmlFor="batchLimit">
                Batch limit (sends in a row)
              </label>
              <input
                id="batchLimit"
                type="number"
                min={1}
                className="field w-full"
                value={form.batchLimit}
                onChange={(e) => update('batchLimit', e.target.value)}
              />
              {w.batchLimit && <p className="mt-1 text-xs text-amber-700">&#9888; {w.batchLimit}</p>}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink-1" htmlFor="maxSendsPerHour">
                Max sends per hour
              </label>
              <input
                id="maxSendsPerHour"
                type="number"
                min={1}
                className="field w-full"
                value={form.maxSendsPerHour}
                onChange={(e) => update('maxSendsPerHour', e.target.value)}
              />
              {w.maxSendsPerHour && (
                <p className="mt-1 text-xs text-amber-700">&#9888; {w.maxSendsPerHour}</p>
              )}
            </div>
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-3 text-sm font-medium text-ink-1">Batch cooldown</legend>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink-1" htmlFor="cooldownMinMin">
                Min cooldown (minutes)
              </label>
              <input
                id="cooldownMinMin"
                type="number"
                min={1}
                className="field w-full"
                value={form.cooldownMinMin}
                onChange={(e) => update('cooldownMinMin', e.target.value)}
              />
              {w.cooldownMinMin && (
                <p className="mt-1 text-xs text-amber-700">&#9888; {w.cooldownMinMin}</p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink-1" htmlFor="cooldownMaxMin">
                Max cooldown (minutes)
              </label>
              <input
                id="cooldownMaxMin"
                type="number"
                min={1}
                className="field w-full"
                value={form.cooldownMaxMin}
                onChange={(e) => update('cooldownMaxMin', e.target.value)}
              />
              {w.cooldownMaxMin && (
                <p className="mt-1 text-xs text-amber-700">&#9888; {w.cooldownMaxMin}</p>
              )}
            </div>
          </div>
        </fieldset>
      </div>

      <div className="flex flex-col gap-2">
        <div>
          <button
            onClick={handleSave}
            disabled={saving || confirmed}
            className="btn-primary"
          >
            {saving ? (
              <span className="flex items-center gap-2">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Saving...
              </span>
            ) : confirmed ? (
              <span className="flex items-center gap-2">&#10003; Applied to worker</span>
            ) : (
              'Save'
            )}
          </button>
        </div>
        {repaced != null && repaced > 0 && (
          <p className="text-sm text-ink-2">
            Re-paced {repaced} waiting send{repaced === 1 ? '' : 's'} to the new limits.
          </p>
        )}
        {saveError && <p className="text-sm text-red-600">{saveError}</p>}
      </div>
    </section>
  );
}
