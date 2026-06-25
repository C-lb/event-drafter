'use client';

import { useState, useTransition } from 'react';
import { updateContact, deleteContact, clearAllContacts } from './actions';

interface Row {
  id: number;
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

export function ContactsTable({ rows: initial }: Props) {
  const [rows, setRows] = useState<Row[]>(initial);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Row | null>(null);
  const [isPending, start] = useTransition();
  const [banner, setBanner] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearPhrase, setClearPhrase] = useState('');

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
            <th className="border-b border-line px-3 py-2 text-left font-medium">First name</th>
            <th className="border-b border-line px-3 py-2 text-left font-medium">Last name</th>
            <th className="border-b border-line px-3 py-2 text-left font-medium">Phone</th>
            <th className="border-b border-line px-3 py-2 text-left font-medium">Secondary phone</th>
            <th className="border-b border-line px-3 py-2 text-left font-medium">Email</th>
            <th className="border-b border-line px-3 py-2 text-left font-medium">Remarks</th>
            <th className="border-b border-line px-3 py-2 text-left font-medium w-32">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isEditing = editingId === r.id && draft !== null;
            const inputCls = 'field w-full';
            return (
              <tr key={r.id} className={isEditing ? 'bg-accent-soft' : ''}>
                {isEditing ? (
                  <>
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
                      <input className={inputCls} value={draft.secondary_phone_e164 ?? ''} onChange={(e) => setDraft({ ...draft, secondary_phone_e164: e.target.value })} />
                    </td>
                    <td className="border-b border-line px-2 py-1.5">
                      <input className={inputCls} value={draft.email ?? ''} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
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
                    <td className="border-b border-line px-3 py-2">{r.first_name}</td>
                    <td className="border-b border-line px-3 py-2">{r.last_name ?? ''}</td>
                    <td className="border-b border-line px-3 py-2">{r.phone_e164}</td>
                    <td className="border-b border-line px-3 py-2">{r.secondary_phone_e164 ?? ''}</td>
                    <td className="border-b border-line px-3 py-2">{r.email ?? ''}</td>
                    <td className="border-b border-line px-3 py-2">{r.remarks ?? ''}</td>
                    <td className="border-b border-line px-3 py-2 space-x-1">
                      <button onClick={() => beginEdit(r)} className="btn btn-sm">Edit</button>
                      <button onClick={() => remove(r)} disabled={isPending} className="btn-ghost btn-sm text-red-700 disabled:opacity-50">Delete</button>
                    </td>
                  </>
                )}
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr><td colSpan={7} className="border-b border-line px-3 py-4 text-center text-ink-3">No contacts. Re-sync from your Sheet to repopulate.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
