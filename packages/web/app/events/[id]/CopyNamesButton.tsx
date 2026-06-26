'use client';

import { useState } from 'react';

/** Copies a list of names (one per line) to the clipboard with brief feedback. */
export function CopyNamesButton({ names, label }: { names: string[]; label: string }) {
  const [copied, setCopied] = useState(false);

  if (names.length === 0) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(names.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can reject without a user gesture / on insecure origins.
      setCopied(false);
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      className="btn btn-sm text-xs"
      title={`Copy ${label} (${names.length}), one name per line`}
    >
      {copied ? 'Copied ✓' : `Copy ${label}`}
    </button>
  );
}
