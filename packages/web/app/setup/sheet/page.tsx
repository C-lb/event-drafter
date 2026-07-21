'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import {
  previewAction,
  saveSheetBinding,
  getInitialPickerState,
  deleteHistoryItem,
} from './actions';

interface PreviewState {
  spreadsheet_id: string;
  range: string;
  title: string;
  preview: { headers: string[]; rows: string[][] };
}

interface HistoryItem {
  spreadsheet_id: string;
  sheet_url: string;
  title: string;
  range: string;
  last_used: number;
}

const FIELDS = [
  'first_name',
  'last_name',
  'phone_e164',
  'secondary_phone_e164',
  'email',
  'remarks',
] as const;
type Field = (typeof FIELDS)[number];
const REQUIRED: Field[] = ['first_name', 'phone_e164'];

// Synonym table, ordered by preference (earlier = stronger match). Each entry is
// a list of substrings that, if present (case-insensitive) in a sheet header,
// indicate that column maps to the field. The matcher walks the priority list
// and picks the first header that matches.
const SYNONYMS: Record<Field, string[]> = {
  first_name: ['first name', 'firstname', 'given name', 'preferred name', 'first', 'name'],
  last_name: ['last name', 'lastname', 'surname', 'family name', 'last'],
  phone_e164: [
    'phone_e164', 'primary phone', 'mobile number', 'phone number',
    'contact number', 'contact no', 'contact', 'whatsapp', 'mobile',
    'phone', 'cell', 'hp',
  ],
  secondary_phone_e164: [
    'secondary phone', 'alternate phone', 'backup phone', 'pa phone',
    'assistant phone', 'secondary number', 'office phone', 'home phone',
    'secondary', 'alt phone',
  ],
  email: ['email address', 'work email', 'personal email', 'e-mail', 'email', 'mail'],
  remarks: [
    'remarks', 'remark', 'notes', 'note', 'comments', 'comment',
    'dietary requirements', 'dietary requirement', 'dietary',
    'diet', 'preferences', 'preference', 'personal note', 'interests',
  ],
};

function autoMap(headers: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  const norm = (s: string) => s.toLowerCase().replace(/[_\s-]+/g, ' ').trim();
  const normHeaders = headers.map((h) => ({ raw: h, n: norm(h) }));
  const used = new Set<string>();

  for (const field of FIELDS) {
    for (const synonym of SYNONYMS[field]) {
      const target = norm(synonym);
      const exact = normHeaders.find((h) => h.n === target && !used.has(h.raw));
      if (exact) { result[field] = exact.raw; used.add(exact.raw); break; }
      const partial = normHeaders.find((h) => h.n.includes(target) && !used.has(h.raw));
      if (partial) { result[field] = partial.raw; used.add(partial.raw); break; }
    }
  }
  return result;
}

function timeAgo(ts: number): string {
  const ms = Date.now() - ts;
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

export default function SheetPickerPage() {
  const [url, setUrl] = useState('');
  const [range, setRange] = useState('A1:Z');
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isPending, start] = useTransition();

  useEffect(() => {
    void (async () => {
      const init = await getInitialPickerState();
      if (init.last_sheet_url) setUrl(init.last_sheet_url);
      setHistory(init.history);
    })();
  }, []);

  const doPreview = (overrideUrl?: string, overrideRange?: string) => {
    const useUrl = overrideUrl ?? url;
    const useRange = overrideRange ?? range;
    if (overrideUrl !== undefined) setUrl(overrideUrl);
    if (overrideRange !== undefined) setRange(overrideRange);
    setErr(null);
    start(async () => {
      try {
        const r = await previewAction({ sheet_url: useUrl, range: useRange });
        setPreview(r);
        const init = await getInitialPickerState();
        setHistory(init.history);
        setMapping(autoMap(r.preview.headers));
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'unknown error');
      }
    });
  };

  const doSave = () => {
    if (!preview) return;
    setErr(null);
    start(async () => {
      try {
        await saveSheetBinding({
          spreadsheet_id: preview.spreadsheet_id,
          range: preview.range,
          column_mapping: {
            first_name: mapping.first_name!,
            last_name: mapping.last_name,
            phone_e164: mapping.phone_e164!,
            secondary_phone_e164: mapping.secondary_phone_e164,
            email: mapping.email,
            remarks: mapping.remarks,
          },
        });
        setSaved(true);
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'unknown error');
      }
    });
  };

  const removeFromHistory = (spreadsheet_id: string) => {
    start(async () => {
      await deleteHistoryItem({ spreadsheet_id });
      setHistory((prev) => prev.filter((h) => h.spreadsheet_id !== spreadsheet_id));
    });
  };

  return (
    <section className="mx-auto max-w-2xl space-y-7">
      <h2 className="text-2xl font-semibold tracking-tight">Pick contacts sheet</h2>

      <div className="card space-y-3 p-5">
        <label className="block text-sm font-medium text-ink">Sheet URL or ID</label>
        <input
          className="field w-full"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://docs.google.com/spreadsheets/d/..."
        />
        <label className="block text-sm font-medium text-ink">Range</label>
        <input
          className="field w-full"
          value={range}
          onChange={(e) => setRange(e.target.value)}
          placeholder="A1:Z (or SheetName!A1:Z)"
        />
        <button
          onClick={() => doPreview()}
          disabled={isPending || !url}
          className="btn-primary"
        >
          {isPending ? 'Loading…' : 'Preview'}
        </button>
      </div>

      {history.length > 0 && (
        <div className="space-y-3">
          <h3 className="eyebrow">Recent sheets</h3>
          <ul className="space-y-2">
            {history.map((h) => (
              <li
                key={h.spreadsheet_id}
                className="card flex items-center justify-between gap-2 p-4 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <span className="font-medium text-ink">{h.title}</span>
                  <span className="ml-2 text-xs text-ink-3">
                    {h.range} · {timeAgo(h.last_used)}
                  </span>
                </div>
                <button
                  onClick={() => doPreview(h.sheet_url, h.range)}
                  disabled={isPending}
                  className="btn btn-sm"
                  type="button"
                  title={`Re-check ${h.title} for new columns and rows`}
                >
                  {isPending ? 'Updating…' : 'Update'}
                </button>
                <button
                  onClick={() => removeFromHistory(h.spreadsheet_id)}
                  className="btn btn-sm"
                  type="button"
                  aria-label={`Remove ${h.title} from history`}
                  title="Remove from history"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {err && (
        <p className="rounded-card bg-red-50 p-4 text-sm text-red-700 ring-1 ring-inset ring-red-600/20">
          {err}
        </p>
      )}

      {preview && (
        <div className="space-y-3">
          <h3 className="text-base font-semibold">
            {preview.title}, preview ({preview.preview.rows.length} row{preview.preview.rows.length === 1 ? '' : 's'})
          </h3>
          <div className="max-h-72 overflow-y-auto overflow-x-auto rounded-card ring-1 ring-inset ring-line">
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 z-10 bg-surface-2 text-ink-2">
                <tr>{preview.preview.headers.map((h) => <th key={h} className="border-b border-line px-2 py-1 text-left">{h}</th>)}</tr>
              </thead>
              <tbody>
                {preview.preview.rows.map((r, i) => (
                  <tr key={i}>{r.map((c, j) => <td key={j} className="border-b border-line px-2 py-1">{c}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="text-base font-semibold">Column mapping</h3>
          <p className="text-xs text-ink-2">For each app field, pick the matching Sheet column. * = required.</p>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {FIELDS.map((f) => (
              <label key={f} className="flex items-center gap-2">
                <span className="w-44 text-ink">{f}{REQUIRED.includes(f) && '*'}</span>
                <select
                  className="field flex-1"
                  value={mapping[f] ?? ''}
                  onChange={(e) => setMapping({ ...mapping, [f]: e.target.value })}
                >
                  <option value="">— skip —</option>
                  {preview.preview.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
            ))}
          </div>
          <button
            onClick={doSave}
            disabled={isPending || !mapping.first_name || !mapping.phone_e164}
            className="btn-primary"
          >
            Save binding
          </button>
        </div>
      )}

      {saved && (
        <p className="rounded-card bg-emerald-50 p-4 text-sm text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
          Saved. <Link href="/setup/import" className="font-medium text-accent hover:text-accent-hover">Continue to import →</Link>
        </p>
      )}
    </section>
  );
}
