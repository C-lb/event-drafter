'use client';

import { useMemo, useState, useTransition } from 'react';
import { updateContact, deleteContact, clearAllContacts } from './actions';

interface Row {
  id: number;
  sheet_row_index: number | null;
  first_name: string;
  last_name: string | null;
  phone_e164: string;
  secondary_phone_e164: string | null;
  email: string | null;
  remarks: string | null;
}

interface Props {
  rows: Row[];
}

const CLEAR_PHRASE = 'DELETE ALL CONTACTS';

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-[1.05em] w-[1.05em] flex-none" aria-hidden>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-[1.05em] w-[1.05em] flex-none" aria-hidden>
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6" />
    </svg>
  );
}

type SortKey = 'row' | 'first_name' | 'last_name' | 'phone_e164' | 'email';
type SortDir = 'asc' | 'desc';

const SORT_COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'row', label: '#' },
  { key: 'first_name', label: 'First name' },
  { key: 'last_name', label: 'Last name' },
  { key: 'phone_e164', label: 'Phone' },
  { key: 'email', label: 'Email' },
];

function sortValue(r: Row, key: SortKey): string | number {
  switch (key) {
    case 'row': return r.sheet_row_index ?? Number.MAX_SAFE_INTEGER;
    case 'first_name': return r.first_name.toLowerCase();
    case 'last_name': return (r.last_name ?? '').toLowerCase();
    case 'phone_e164': return r.phone_e164;
    case 'email': return (r.email ?? '').toLowerCase();
  }
}

export function ContactsTable({ rows: initial }: Props) {
  const [rows, setRows] = useState<Row[]>(initial);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Row | null>(null);
  const [isPending, start] = useTransition();
  const [banner, setBanner] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearPhrase, setClearPhrase] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'row', dir: 'asc' });

  const toggleSort = (key: SortKey) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  };

  const sortedRows = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = sortValue(a, sort.key);
      const bv = sortValue(b, sort.key);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [rows, sort]);

  const beginEdit = (r: Row) => {
    setEditingId(r.id);
    setDraft({ ...r });
    setBanner(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(null);
  };

  const save = () => {
    if (!draft) return;
    setBanner(null);
    start(async () => {
      const r = await updateContact({
        id: draft.id,
        first_name: draft.first_name,
        last_name: draft.last_name ?? '',
        phone_e164: draft.phone_e164,
        secondary_phone_e164: draft.secondary_phone_e164 ?? '',
        email: draft.email ?? '',
        remarks: draft.remarks ?? '',
      });
      if (!r.ok) { setBanner({ kind: 'err', text: r.error }); return; }
      setRows((prev) => prev.map((row) => (row.id === draft.id ? { ...draft, last_name: draft.last_name?.trim() || null } : row)));
      cancelEdit();
      setBanner({ kind: 'ok', text: 'Saved.' });
    });
  };

  const remove = (r: Row) => {
    const name = `${r.first_name}${r.last_name ? ' ' + r.last_name : ''}`;
    if (!window.confirm(`Delete ${name} (${r.phone_e164})? This also removes all of their invites, replies, and follow-ups.`)) return;
    setBanner(null);
    start(async () => {
      const res = await deleteContact({ id: r.id });
      if (!res.ok) { setBanner({ kind: 'err', text: res.error }); return; }
      setRows((prev) => prev.filter((x) => x.id !== r.id));
      setBanner({ kind: 'ok', text: `Deleted ${name}${res.cascaded > 0 ? ` (cascaded ${res.cascaded} invite${res.cascaded === 1 ? '' : 's'})` : ''}.` });
    });
  };

  const doClearAll = () => {
    setBanner(null);
    start(async () => {
      const res = await clearAllContacts({ confirm_phrase: clearPhrase });
      if (!res.ok) { setBanner({ kind: 'err', text: res.error }); return; }
      setRows([]);
      setClearOpen(false);
      setClearPhrase('');
      setBanner({ kind: 'ok', text: `Cleared ${res.deleted} contacts.` });
    });
  };

  return (
    <div className="space-y-3">
      {banner && (
        <div className={`rounded-card p-4 text-sm ring-1 ring-inset ${banner.kind === 'ok' ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' : 'bg-red-50 text-red-700 ring-red-600/20'}`}>
          {banner.text}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          onClick={() => setClearOpen((v) => !v)}
          className="btn btn-sm"
        >
          Clear all contacts…
        </button>
      </div>

      {clearOpen && (
        <div className="rounded-card bg-red-50 p-4 text-sm text-red-700 ring-1 ring-inset ring-red-600/20">
          <p className="font-medium text-red-900">This deletes every contact and cascades to all of their invites, replies, and follow-ups across every event.</p>
          <p className="mt-1 text-red-700">Type <code className="rounded-sm bg-surface px-1 font-mono">{CLEAR_PHRASE}</code> below to confirm.</p>
          <div className="mt-3 flex gap-2">
            <input
              type="text"
              value={clearPhrase}
              onChange={(e) => setClearPhrase(e.target.value)}
              placeholder={CLEAR_PHRASE}
              className="field flex-1 font-mono"
            />
            <button
              onClick={doClearAll}
              disabled={isPending || clearPhrase !== CLEAR_PHRASE}
              className="btn-danger btn-sm disabled:opacity-50"
            >
              {isPending ? 'Deleting…' : 'Delete everything'}
            </button>
            <button
              onClick={() => { setClearOpen(false); setClearPhrase(''); }}
              className="btn btn-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-ink-2">
          <tr>
            {SORT_COLUMNS.map((c) => (
              <th
                key={c.key}
                className={`border-b border-line px-3 py-2 font-medium ${c.key === 'row' ? 'w-12 text-right' : 'text-left'}`}
                title={c.key === 'row' ? 'Source sheet row number' : undefined}
              >
                <button
                  type="button"
                  onClick={() => toggleSort(c.key)}
                  className={`inline-flex items-center gap-1 hover:text-ink ${sort.key === c.key ? 'text-ink' : ''}`}
                >
                  {c.label}
                  {sort.key === c.key && <span aria-hidden>{sort.dir === 'asc' ? '▲' : '▼'}</span>}
                </button>
              </th>
            ))}
            <th className="border-b border-line px-3 py-2 text-left font-medium">Secondary phone</th>
            <th className="border-b border-line px-3 py-2 text-left font-medium">Remarks</th>
            <th className="border-b border-line px-3 py-2 text-left font-medium w-20">Actions</th>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((r) => {
            const isEditing = editingId === r.id && draft !== null;
            const inputCls = 'field w-full';
            return (
              <tr key={r.id} className={isEditing ? 'bg-accent-soft' : ''}>
                {isEditing ? (
                  <>
                    <td className="border-b border-line px-3 py-1.5 text-right font-mono text-xs tabular-nums text-ink-3">{r.sheet_row_index ?? '·'}</td>
                    <td className="border-b border-line px-2 py-1.5">
                      <input className={inputCls} value={draft.first_name} onChange={(e) => setDraft({ ...draft, first_name: e.target.value })} />
                    </td>
                    <td className="border-b border-line px-2 py-1.5">
                      <input className={inputCls} value={draft.last_name ?? ''} onChange={(e) => setDraft({ ...draft, last_name: e.target.value })} />
                    </td>
                    <td className="border-b border-line px-2 py-1.5">
                      <input className={inputCls} value={draft.phone_e164} onChange={(e) => setDraft({ ...draft, phone_e164: e.target.value })} />
                    </td>
                    <td className="border-b border-line px-2 py-1.5">
                      <input className={inputCls} value={draft.email ?? ''} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
                    </td>
                    <td className="border-b border-line px-2 py-1.5">
                      <input className={inputCls} value={draft.secondary_phone_e164 ?? ''} onChange={(e) => setDraft({ ...draft, secondary_phone_e164: e.target.value })} />
                    </td>
                    <td className="border-b border-line px-2 py-1.5">
                      <input className={inputCls} value={draft.remarks ?? ''} onChange={(e) => setDraft({ ...draft, remarks: e.target.value })} />
                    </td>
                    <td className="border-b border-line px-2 py-1.5 space-x-1">
                      <button onClick={save} disabled={isPending} className="btn-primary btn-sm disabled:opacity-50">
                        {isPending ? '…' : 'Save'}
                      </button>
                      <button onClick={cancelEdit} disabled={isPending} className="btn btn-sm">
                        Cancel
                      </button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="border-b border-line px-3 py-2 text-right font-mono text-xs tabular-nums text-ink-3">{r.sheet_row_index ?? '·'}</td>
                    <td className="border-b border-line px-3 py-2">{r.first_name}</td>
                    <td className="border-b border-line px-3 py-2">{r.last_name ?? ''}</td>
                    <td className="border-b border-line px-3 py-2">{r.phone_e164}</td>
                    <td className="border-b border-line px-3 py-2">{r.email ?? ''}</td>
                    <td className="border-b border-line px-3 py-2">{r.secondary_phone_e164 ?? ''}</td>
                    <td className="border-b border-line px-3 py-2">{r.remarks ?? ''}</td>
                    <td className="border-b border-line px-3 py-2 space-x-1">
                      <button onClick={() => beginEdit(r)} className="btn-ghost btn-sm px-2" title={`Edit ${r.first_name}`} aria-label={`Edit ${r.first_name}`}>
                        <PencilIcon />
                      </button>
                      <button onClick={() => remove(r)} disabled={isPending} className="btn-ghost btn-sm px-2 text-red-700 disabled:opacity-50" title={`Delete ${r.first_name}`} aria-label={`Delete ${r.first_name}`}>
                        <TrashIcon />
                      </button>
                    </td>
                  </>
                )}
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr><td colSpan={8} className="border-b border-line px-3 py-4 text-center text-ink-3">No contacts. Re-sync from your Sheet to repopulate.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
