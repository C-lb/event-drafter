'use client';

import { useRef, useState } from 'react';
import { applyTemplate } from '../actions';

const VARIABLES = ['first name', 'last name', 'event name', 'date', 'venue'] as const;

const PLACEHOLDER = `Hi [first name]! You're invited to [event name] on [date] at [venue]. Hope to see you there!`;

export function TemplatePopover({ eventId, onApplied }: { eventId: number; onApplied: () => void }) {
  const [open, setOpen] = useState(false);
  const [template, setTemplate] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Insert a [token] at the caret, replacing any selection.
  const insertVar = (name: string) => {
    const ta = taRef.current;
    const token = `[${name}]`;
    if (!ta) {
      setTemplate((t) => t + token);
      return;
    }
    const start = ta.selectionStart ?? template.length;
    const end = ta.selectionEnd ?? template.length;
    const next = template.slice(0, start) + token + template.slice(end);
    setTemplate(next);
    // Restore focus and move caret past the inserted token.
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + token.length;
      ta.setSelectionRange(pos, pos);
    });
  };

  const apply = async () => {
    if (!template.trim() || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await applyTemplate({ event_id: eventId, template });
      setMsg(`Applied to ${r.applied} invite${r.applied === 1 ? '' : 's'}.`);
      onApplied();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed to apply template.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className="btn btn-sm" aria-expanded={open}>
        Use my own template
      </button>

      {open && (
        <>
          {/* Click-away backdrop */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 z-20 mt-2 w-[28rem] max-w-[90vw] rounded-card border border-line bg-surface p-4 shadow-soft">
            <div className="flex items-baseline justify-between">
              <h4 className="text-sm font-semibold">Your template</h4>
              <button type="button" onClick={() => setOpen(false)} className="text-xs text-ink-3 hover:text-ink-2">
                Close
              </button>
            </div>
            <p className="mt-1 text-xs text-ink-2">
              Applies to all invites not yet approved or sent, replacing the worker&apos;s drafts. Tap a variable to insert it.
            </p>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {VARIABLES.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => insertVar(v)}
                  className="rounded-full bg-line px-2.5 py-1 text-xs text-ink-2 hover:bg-line-strong"
                  title={`Insert [${v}]`}
                >
                  [{v}]
                </button>
              ))}
            </div>

            <textarea
              ref={taRef}
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              placeholder={PLACEHOLDER}
              className="field mt-3 h-32 w-full resize-y text-sm"
              aria-label="Message template"
            />

            <div className="mt-3 flex items-center justify-between gap-2">
              {msg ? (
                <span className="text-xs text-ink-2">{msg}</span>
              ) : (
                <span className="text-xs text-ink-3">{template.trim().length} chars</span>
              )}
              <button
                type="button"
                onClick={apply}
                disabled={!template.trim() || busy}
                className="btn-primary btn-sm disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? 'Applying…' : 'Apply to all'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
