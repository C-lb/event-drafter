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
    <section className="max-w-2xl space-y-4">
      <h2 className="text-xl font-semibold">Voice & style guide</h2>
      <p className="text-sm text-neutral-700">
        This block becomes part of the system prompt for every draft. It is cached on the Anthropic side,
        so editing it invalidates the cache (one-time cost on the next event&apos;s first draft).
      </p>
      <textarea
        className="h-72 w-full rounded border border-neutral-300 p-3 font-mono text-sm"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={isPending} className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          Save
        </button>
        {saved && <span className="text-sm text-green-700">Saved.</span>}
      </div>
    </section>
  );
}
