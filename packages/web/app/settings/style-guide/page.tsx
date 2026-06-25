'use client';

import { useEffect, useState, useTransition } from 'react';
import { getStyleGuide, saveStyleGuide } from './actions';

export default function StyleGuidePage() {
  const [value, setValue] = useState('');
  const [saved, setSaved] = useState(false);
  const [isPending, start] = useTransition();

  useEffect(() => {
    start(async () => setValue(await getStyleGuide()));
  }, []);

  const save = () => start(async () => {
    await saveStyleGuide({ value });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  });

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <h2 className="text-2xl font-semibold tracking-tight">Voice and style guide</h2>
      <p className="rounded-card bg-accent-soft p-4 text-sm text-accent ring-1 ring-inset ring-accent-line">
        This block becomes part of the system prompt for every draft. It is cached on the Anthropic side,
        so editing it invalidates the cache (a one-time cost on the next event&apos;s first draft).
      </p>
      <textarea
        className="field h-72 w-full resize-y font-mono"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={isPending} className="btn-primary">
          Save
        </button>
        {saved && <span className="text-sm text-emerald-700">Saved.</span>}
      </div>
    </section>
  );
}
