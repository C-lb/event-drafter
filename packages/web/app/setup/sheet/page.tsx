'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { previewAction, saveSheetBinding } from './actions';

interface PreviewState {
  spreadsheet_id: string;
  range: string;
  preview: { headers: string[]; rows: string[][] };
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

export default function SheetPickerPage() {
  const [url, setUrl] = useState('');
  const [range, setRange] = useState('Contacts!A1:F');
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, start] = useTransition();

  const doPreview = () => {
    setErr(null);
    start(async () => {
      try {
        const r = await previewAction({ sheet_url: url, range });
        setPreview(r);
        const defaults: Record<string, string> = {};
        for (const h of r.preview.headers) {
          const low = h.toLowerCase().replace(/\s+/g, '_');
          if ((FIELDS as readonly string[]).includes(low)) {
            defaults[low] = h;
          }
        }
        setMapping(defaults);
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

  return (
    <section className="max-w-3xl space-y-4">
      <h2 className="text-xl font-semibold">Step 3 — Pick contacts Sheet</h2>

      <div className="space-y-2">
        <label className="block text-sm font-medium">Sheet URL or ID</label>
        <input
          className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://docs.google.com/spreadsheets/d/..."
        />
        <label className="block text-sm font-medium">Range</label>
        <input
          className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
          value={range}
          onChange={(e) => setRange(e.target.value)}
        />
        <button onClick={doPreview} disabled={isPending || !url} className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {isPending ? 'Loading…' : 'Preview'}
        </button>
      </div>

      {err && <p className="rounded bg-red-50 p-3 text-sm text-red-700">{err}</p>}

      {preview && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Preview ({preview.preview.rows.length} rows)</h3>
          <table className="w-full border-collapse text-xs">
            <thead className="bg-neutral-100">
              <tr>{preview.preview.headers.map((h) => <th key={h} className="border px-2 py-1 text-left">{h}</th>)}</tr>
            </thead>
            <tbody>
              {preview.preview.rows.map((r, i) => (
                <tr key={i}>{r.map((c, j) => <td key={j} className="border px-2 py-1">{c}</td>)}</tr>
              ))}
            </tbody>
          </table>

          <h3 className="text-sm font-semibold">Column mapping</h3>
          <p className="text-xs text-neutral-600">For each app field, pick the matching Sheet column. * = required.</p>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {FIELDS.map((f) => (
              <label key={f} className="flex items-center gap-2">
                <span className="w-44">{f}{REQUIRED.includes(f) && '*'}</span>
                <select
                  className="flex-1 rounded border border-neutral-300 px-2 py-1"
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
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Save binding
          </button>
        </div>
      )}

      {saved && (
        <p className="rounded bg-green-50 p-3 text-sm text-green-700">
          Saved. <Link href="/setup/import" className="underline">Continue to import →</Link>
        </p>
      )}
    </section>
  );
}
