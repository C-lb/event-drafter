'use client';

import { useState, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  saveInviteLogistics,
  generateTargetedFollowUps,
  createTemplateFollowUps,
} from './actions';

type Invitee = {
  invite_id: number;
  contact_id: number;
  first_name: string;
  last_name: string | null;
  phone_e164: string;
  remarks: string | null;
  rsvp: string;
  has_reply: boolean;
  chauffeured: boolean;
  parking_coupon: boolean;
  takes_bus: boolean;
  food_pref: string | null;
};
type Template = { id: number; name: string; body: string };
type Banner = { kind: 'err'; text: string } | null;
const TOKENS = '{first_name} {last_name} {event_name} {event_date} {venue} {food_pref} {parking} {bus} {chauffeur}';

export function FollowUpComposer({
  eventId, invitees: initial, templates, preselectInviteId,
}: { eventId: number; invitees: Invitee[]; templates: Template[]; preselectInviteId?: number }) {
  const router = useRouter();
  const [rows, setRows] = useState<Invitee[]>(initial);
  // Seed the selection from a deep-link (a reply card's "Follow up privately"),
  // but only if that invitee is actually in this event's follow-up list.
  const [picked, setPicked] = useState<Set<number>>(() =>
    preselectInviteId && initial.some((r) => r.invite_id === preselectInviteId)
      ? new Set([preselectInviteId])
      : new Set(),
  );
  const [lastIndex, setLastIndex] = useState<number | null>(null);
  const [tab, setTab] = useState<'general' | 'tailored' | 'template'>('general');
  const [body, setBody] = useState('');
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [saveTpl, setSaveTpl] = useState(false);
  const [tplName, setTplName] = useState('');
  const [banner, setBanner] = useState<Banner>(null);
  const [isPending, start] = useTransition();

  const pickedIds = useMemo(() => Array.from(picked), [picked]);

  const toggleSelect = (id: number, index: number, shiftKey: boolean) => {
    const next = new Set(picked);
    if (shiftKey && lastIndex !== null && lastIndex !== index) {
      const [from, to] = lastIndex < index ? [lastIndex, index] : [index, lastIndex];
      const willSelect = !picked.has(id);
      for (let i = from; i <= to; i++) {
        const rid = rows[i]!.invite_id;
        if (willSelect) next.add(rid); else next.delete(rid);
      }
    } else {
      if (next.has(id)) next.delete(id); else next.add(id);
    }
    setPicked(next);
    setLastIndex(index);
  };

  const selectAll = () => { setPicked(new Set(rows.map((r) => r.invite_id))); setLastIndex(null); };
  const clearAll = () => { setPicked(new Set()); setLastIndex(null); };

  const setLogistics = (invite_id: number, patch: Partial<Invitee>) => {
    let merged: Invitee | undefined;
    setRows((rs) =>
      rs.map((r) => {
        if (r.invite_id !== invite_id) return r;
        merged = { ...r, ...patch };
        return merged;
      }),
    );
    if (!merged) return;
    const row = merged;
    start(async () => {
      await saveInviteLogistics({
        invite_id,
        chauffeured: row.chauffeured,
        parking_coupon: row.parking_coupon,
        takes_bus: row.takes_bus,
        food_pref: row.food_pref,
      });
    });
  };

  // Local-only edit while typing in the food-pref cell; the save fires on blur.
  const editFoodLocal = (invite_id: number, value: string) => {
    setRows((rs) => rs.map((r) => (r.invite_id === invite_id ? { ...r, food_pref: value } : r)));
  };

  const runLLM = (mode: 'general' | 'tailored') => {
    setBanner(null);
    start(async () => {
      const res = await generateTargetedFollowUps({ event_id: eventId, invite_ids: pickedIds, mode });
      if (!res.ok) { setBanner({ kind: 'err', text: res.error }); return; }
      router.push('/follow-ups');
    });
  };

  const runTemplate = () => {
    setBanner(null);
    start(async () => {
      const res = await createTemplateFollowUps({
        event_id: eventId, invite_ids: pickedIds, body,
        save_as_template: saveTpl, template_name: tplName || undefined,
      });
      if (!res.ok) { setBanner({ kind: 'err', text: res.error }); return; }
      router.push('/follow-ups');
    });
  };

  const genDisabled = picked.size === 0 || isPending;

  return (
    <div className="mt-6 space-y-6">
      {banner && (
        <p className="rounded-md p-3 text-sm badge-red">
          {banner.text}
        </p>
      )}

      {/* Select controls + counter */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-2">
          {picked.size} picked · {rows.length} invited
        </p>
        <div className="flex gap-2 text-xs">
          <button
            onClick={selectAll}
            disabled={rows.length === 0 || picked.size === rows.length}
            className="btn btn-sm"
          >
            Select all ({rows.length})
          </button>
          <button onClick={clearAll} disabled={picked.size === 0} className="btn btn-sm">
            Clear
          </button>
        </div>
      </div>

      {/* Invitee table */}
      {rows.length === 0 ? (
        <p className="card-quiet p-6 text-center text-sm text-ink-2">
          No one is invited to this event yet.
        </p>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-3">
                <th className="w-10 p-3"></th>
                <th className="p-3 font-medium">Name</th>
                <th className="p-3 font-medium">RSVP</th>
                <th className="p-3 text-center font-medium">Chauffeur</th>
                <th className="p-3 text-center font-medium">Parking</th>
                <th className="p-3 text-center font-medium">Bus</th>
                <th className="p-3 font-medium">Food preference</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const isPicked = picked.has(r.invite_id);
                return (
                  <tr
                    key={r.invite_id}
                    className={`border-b border-line/60 last:border-0 ${isPicked ? 'bg-accent-soft' : ''}`}
                  >
                    <td className="p-3 align-top">
                      <input
                        type="checkbox"
                        checked={isPicked}
                        onChange={() => {}}
                        onClick={(e) => toggleSelect(r.invite_id, i, e.shiftKey)}
                        aria-label={`Select ${r.first_name}`}
                        className="h-4 w-4 cursor-pointer accent-accent"
                      />
                    </td>
                    <td className="p-3 align-top">
                      <p className="font-medium">
                        {r.first_name}{r.last_name ? ' ' + r.last_name : ''}
                      </p>
                      <p className="text-xs text-ink-3">{r.phone_e164}</p>
                      {r.remarks && <p className="mt-0.5 text-xs text-ink-2">{r.remarks}</p>}
                    </td>
                    <td className="p-3 align-top">
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="badge badge-neutral capitalize">{r.rsvp}</span>
                        {r.has_reply && <span className="badge badge-green">Replied</span>}
                      </div>
                    </td>
                    <td className="p-3 text-center align-top">
                      <input
                        type="checkbox"
                        checked={r.chauffeured}
                        onChange={(e) => setLogistics(r.invite_id, { chauffeured: e.target.checked })}
                        aria-label={`Chauffeur for ${r.first_name}`}
                        className="h-4 w-4 cursor-pointer accent-accent"
                      />
                    </td>
                    <td className="p-3 text-center align-top">
                      <input
                        type="checkbox"
                        checked={r.parking_coupon}
                        onChange={(e) => setLogistics(r.invite_id, { parking_coupon: e.target.checked })}
                        aria-label={`Parking for ${r.first_name}`}
                        className="h-4 w-4 cursor-pointer accent-accent"
                      />
                    </td>
                    <td className="p-3 text-center align-top">
                      <input
                        type="checkbox"
                        checked={r.takes_bus}
                        onChange={(e) => setLogistics(r.invite_id, { takes_bus: e.target.checked })}
                        aria-label={`Bus for ${r.first_name}`}
                        className="h-4 w-4 cursor-pointer accent-accent"
                      />
                    </td>
                    <td className="p-3 align-top">
                      <input
                        className="field w-full min-w-[9rem] text-xs"
                        placeholder="e.g. vegetarian"
                        value={r.food_pref ?? ''}
                        onChange={(e) => editFoodLocal(r.invite_id, e.target.value)}
                        onBlur={(e) => setLogistics(r.invite_id, { food_pref: e.target.value })}
                        aria-label={`Food preference for ${r.first_name}`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-ink-3">
        Tip: shift-click a checkbox to select a range. Logistics save on their own as you change them.
      </p>

      {/* Compose panel */}
      <div className="card space-y-4 p-4">
        <div className="flex gap-2">
          {(['general', 'tailored', 'template'] as const).map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setBanner(null); }}
              className={`btn btn-sm capitalize ${tab === t ? 'btn-primary' : ''}`}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === 'general' && (
          <div className="space-y-3">
            <p className="text-sm text-ink-2">
              One shared message for everyone picked. The worker drafts them, then they land in Follow-ups for review.
            </p>
            <button onClick={() => runLLM('general')} disabled={genDisabled} className="btn-primary">
              {isPending ? 'Working…' : `Generate ${picked.size} draft${picked.size === 1 ? '' : 's'}`}
            </button>
          </div>
        )}

        {tab === 'tailored' && (
          <div className="space-y-3">
            <p className="text-sm text-ink-2">
              A message tailored to each person using their RSVP and logistics. Drafts land in Follow-ups for review.
            </p>
            <button onClick={() => runLLM('tailored')} disabled={genDisabled} className="btn-primary">
              {isPending ? 'Working…' : `Generate ${picked.size} draft${picked.size === 1 ? '' : 's'}`}
            </button>
          </div>
        )}

        {tab === 'template' && (
          <div className="space-y-3">
            <label className="block text-sm">
              <span className="text-ink-2">Message template</span>
              <textarea
                className="field mt-1 h-28 w-full"
                placeholder="Hi {first_name}, quick follow-up about {event_name}…"
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </label>
            <p className="text-[11px] text-ink-3">
              Merge fields: <span className="font-mono">{TOKENS}</span>
            </p>

            {templates.length > 0 && (
              <label className="block text-sm">
                <span className="text-ink-2">Load a preset</span>
                <select
                  className="field mt-1 w-full"
                  value={selectedPresetId}
                  onChange={(e) => {
                    setSelectedPresetId(e.target.value);
                    const t = templates.find((x) => String(x.id) === e.target.value);
                    if (t) setBody(t.body);
                  }}
                >
                  <option value="">Choose a saved preset…</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </label>
            )}

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={saveTpl}
                onChange={(e) => setSaveTpl(e.target.checked)}
                className="h-4 w-4 cursor-pointer accent-accent"
              />
              <span className="text-ink-2">Save as a preset (usable on any event)</span>
            </label>
            {saveTpl && (
              <input
                className="field w-full"
                placeholder="Preset name (optional)"
                value={tplName}
                onChange={(e) => setTplName(e.target.value)}
              />
            )}

            <button
              onClick={runTemplate}
              disabled={genDisabled || !body.trim()}
              className="btn-primary"
            >
              {isPending ? 'Working…' : `Generate ${picked.size} draft${picked.size === 1 ? '' : 's'}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
