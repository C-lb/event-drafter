'use client';

import { useEffect, useRef, useState } from 'react';
import { applyTemplate } from '../actions';
import { listTemplates, saveTemplate } from '../follow-up/actions';

const VARIABLES = ['first name', 'last name', 'event name', 'date', 'venue'] as const;

const PLACEHOLDER = `Hi [first name]! You're invited to [event name] on [date] at [venue]. Hope to see you there!`;

type Preset = { id: number; name: string; body: string };

export function TemplatePopover({ eventId, onApplied }: { eventId: number; onApplied: () => void }) {
  const [open, setOpen] = useState(false);
  const [template, setTemplate] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [saveAsPreset, setSaveAsPreset] = useState(false);
  const [presetName, setPresetName] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Presets are shared across every event (message_templates isn't scoped to
  // one event), so load them once whenever the popover opens.
  useEffect(() => {
    if (!open) return;
    setSelectedPresetId('');
    void listTemplates().then(setPresets);
  }, [open]);

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

  // Wrap the current selection in a WhatsApp formatting marker (* for bold,
  // _ for italic). With no selection, drop an empty pair and park the caret
  // between them so the operator can just start typing.
  const wrap = (marker: string) => {
    const ta = taRef.current;
    if (!ta) {
      setTemplate((t) => t + marker + marker);
      return;
    }
    const start = ta.selectionStart ?? template.length;
    const end = ta.selectionEnd ?? template.length;
    const selected = template.slice(start, end);
    const next = template.slice(0, start) + marker + selected + marker + template.slice(end);
    setTemplate(next);
    requestAnimationFrame(() => {
      ta.focus();
      if (selected) {
        // Keep the same text selected, now sitting inside the markers.
        ta.setSelectionRange(start + marker.length, end + marker.length);
      } else {
        const pos = start + marker.length;
        ta.setSelectionRange(pos, pos);
      }
    });
  };

  const apply = async () => {
    if (!template.trim() || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      if (saveAsPreset) {
        const saved = await saveTemplate({ name: presetName || undefined, body: template });
        if (!saved.ok) { setMsg(saved.error); setBusy(false); return; }
      }
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
      <button type="button" onClick={() => setOpen((v) => !v)} className="btn" aria-expanded={open}>
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
              Applies to all invites not yet approved or sent, replacing the worker&apos;s drafts. Tap a variable to insert it, or select text and tap B / I to format.
            </p>

            <div className="mt-3 flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => wrap('*')}
                className="rounded-md bg-line px-2.5 py-1 text-xs font-bold text-ink-2 hover:bg-line-strong"
                title="Bold — wraps selection in *asterisks*"
              >
                B
              </button>
              <button
                type="button"
                onClick={() => wrap('_')}
                className="rounded-md bg-line px-2.5 py-1 text-xs italic text-ink-2 hover:bg-line-strong"
                title="Italic — wraps selection in _underscores_"
              >
                I
              </button>
              <span className="ml-1 text-[11px] text-ink-3">WhatsApp formatting</span>
            </div>

            <div className="mt-2 flex flex-wrap gap-1.5">
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

            {presets.length > 0 && (
              <label className="mt-3 block text-xs">
                <span className="text-ink-2">Load a preset</span>
                <select
                  className="field mt-1 w-full text-sm"
                  value={selectedPresetId}
                  onChange={(e) => {
                    setSelectedPresetId(e.target.value);
                    const p = presets.find((x) => String(x.id) === e.target.value);
                    if (p) setTemplate(p.body);
                  }}
                >
                  <option value="">Choose a saved preset…</option>
                  {presets.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>
            )}

            <textarea
              ref={taRef}
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              placeholder={PLACEHOLDER}
              className="field mt-3 h-32 w-full resize-y text-sm"
              aria-label="Message template"
            />

            <label className="mt-3 flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={saveAsPreset}
                onChange={(e) => setSaveAsPreset(e.target.checked)}
                className="h-4 w-4 cursor-pointer accent-accent"
              />
              <span className="text-ink-2">Save as a preset (usable on any event)</span>
            </label>
            {saveAsPreset && (
              <input
                className="field mt-2 w-full text-sm"
                placeholder="Preset name (optional)"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
              />
            )}

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
