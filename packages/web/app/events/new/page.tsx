'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { searchInbox, createEventFromMessage, previewGmailMessage } from '../actions';
import type { GmailMessageSummary } from '@vip/worker/google/gmail';

interface FullMessage {
  id: string;
  from: string;
  subject: string;
  internal_date: number;
  body_text: string;
}

interface FilterChip {
  label: string;
  query: string;
}

// Curated quick filters. Combinable mentally — clicking a chip replaces the search
// query, which the operator can then refine inline.
const QUICK_FILTERS: FilterChip[] = [
  { label: 'Last 7 days', query: 'newer_than:7d' },
  { label: 'Last 30 days', query: 'newer_than:30d' },
  { label: 'Last 90 days', query: 'newer_than:90d' },
  { label: 'Subject: invitation', query: 'subject:invitation newer_than:90d' },
  { label: 'Subject: event', query: 'subject:event newer_than:90d' },
  { label: 'Subject: RSVP', query: 'subject:rsvp newer_than:90d' },
  { label: 'SPARK', query: 'SPARK newer_than:6m' },
  { label: 'From me', query: 'from:me newer_than:90d' },
  { label: 'With attachment', query: 'has:attachment newer_than:60d' },
  { label: 'Starred', query: 'is:starred newer_than:1y' },
];

type SortMode = 'date_desc' | 'date_asc' | 'subject_asc' | 'sender_asc';

const SENDER_NAME_RE = /^"?([^"<]+?)"?\s*</;
function senderName(from: string): string {
  const m = from.match(SENDER_NAME_RE);
  return (m?.[1] ?? from).trim().toLowerCase();
}

function formatGmailDate(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const dateStr = d.toLocaleDateString('en-SG', sameYear
    ? { day: 'numeric', month: 'short' }
    : { day: 'numeric', month: 'short', year: 'numeric' });
  const timeStr = d.toLocaleTimeString('en-SG', { hour: 'numeric', minute: '2-digit' });
  return `${dateStr}, ${timeStr}`;
}

function avatarLetter(from: string): string {
  const name = senderName(from);
  return (name[0] ?? '?').toUpperCase();
}

function avatarColor(from: string): string {
  const palette = ['bg-rose-200 text-rose-900', 'bg-amber-200 text-amber-900', 'bg-emerald-200 text-emerald-900', 'bg-sky-200 text-sky-900', 'bg-violet-200 text-violet-900', 'bg-orange-200 text-orange-900'];
  let h = 0;
  for (let i = 0; i < from.length; i++) h = (h * 31 + from.charCodeAt(i)) | 0;
  return palette[Math.abs(h) % palette.length]!;
}

// ---------- Heuristic extraction from email body ----------

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

function monthIndex(name: string): number {
  return MONTH_NAMES.indexOf(name.toLowerCase());
}

function extractDate(text: string, fallbackYear: number): { year: number; month: number; day: number } | null {
  // 1. "27 February 2025" or "Thursday, 27 February 2025"
  const longMonth = '(january|february|march|april|may|june|july|august|september|october|november|december)';
  const reFullDay = new RegExp(`\\b(\\d{1,2})\\s+${longMonth}\\s+(\\d{4})\\b`, 'i');
  const mFull = text.match(reFullDay);
  if (mFull) return { day: Number(mFull[1]), month: monthIndex(mFull[2]!), year: Number(mFull[3]) };

  // 2. "February 27, 2025"
  const reMonthFirst = new RegExp(`\\b${longMonth}\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, 'i');
  const mMonth = text.match(reMonthFirst);
  if (mMonth) return { day: Number(mMonth[2]), month: monthIndex(mMonth[1]!), year: Number(mMonth[3]) };

  // 3. "27 February" (no year)
  const reNoYear = new RegExp(`\\b(\\d{1,2})\\s+${longMonth}\\b`, 'i');
  const mNoYear = text.match(reNoYear);
  if (mNoYear) return { day: Number(mNoYear[1]), month: monthIndex(mNoYear[2]!), year: fallbackYear };

  // 4. "27/02/2025" or "27-02-2025" or "2025-02-27"
  const reSlash = text.match(/\b(\d{4})[/-](\d{1,2})[/-](\d{1,2})\b/);
  if (reSlash) return { year: Number(reSlash[1]), month: Number(reSlash[2]) - 1, day: Number(reSlash[3]) };
  const reSlashDmy = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/);
  if (reSlashDmy) return { day: Number(reSlashDmy[1]), month: Number(reSlashDmy[2]) - 1, year: Number(reSlashDmy[3]) };

  return null;
}

function parseTime(token: string): { hour: number; minute: number } | null {
  const m = token.trim().match(/^(\d{1,2})(?::|\.)?(\d{2})?\s*(am|pm|AM|PM)?$/);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  const meridiem = m[3]?.toLowerCase();
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

function extractTime(text: string): { hour: number; minute: number } | null {
  // "9:30 AM to 2:00 PM" / "12:00PM – 2:00PM" / "7.00PM - 9.00PM"
  const range = text.match(/(\d{1,2}[:.]?\d{0,2}\s*(?:am|pm|AM|PM))\s*(?:–|-|to|until)\s*(\d{1,2}[:.]?\d{0,2}\s*(?:am|pm|AM|PM))/);
  if (range) {
    const t = parseTime(range[1]!);
    if (t) return t;
  }
  // "Time: 12:00 PM" or first standalone time-of-day token
  const single = text.match(/\b(\d{1,2}[:.]\d{2}\s*(?:am|pm|AM|PM))\b/);
  if (single) {
    const t = parseTime(single[1]!);
    if (t) return t;
  }
  return null;
}

function extractVenue(text: string): string | null {
  // "Venue: X" or "Location: X"
  const tagged = text.match(/(?:^|\n)\s*(?:Venue|Location)\s*[:\-]\s*([^\n\r]+)/i);
  if (tagged) return tagged[1]!.trim().replace(/[•\-:\s]+$/, '');

  // "at <Venue Name>" — venue follows the word "at", begins with a capital,
  // ends before punctuation or a connector word.
  const atMatch = text.match(/\bat\s+([A-Z][A-Za-z0-9 &',.\-]{3,80}?)(?:\s+(?:on|from|for|tomorrow|today|where|located|to celebrate|with)|[.,\n\r])/);
  if (atMatch) return atMatch[1]!.trim().replace(/[\s,.]+$/, '');

  return null;
}

function toDateTimeLocal(year: number, month: number, day: number, hour: number, minute: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month + 1)}-${pad(day)}T${pad(hour)}:${pad(minute)}`;
}

// Cleans a Gmail subject down to a usable event name. Strips:
//   - Re: / Fwd: prefixes
//   - Bracketed labels like [INVITATION], (External), {Internal}
//   - Standalone noise words: invitation, external, internal, confidential, fyi
//   - Trailing/leading punctuation and double spaces
function cleanSubject(subject: string): string {
  let s = subject.trim();

  // Repeatedly strip prefix garbage: Re:/Fwd:, bracket tags, leading noise
  // words like "Invitation:" or "External -". Loop until stable so chains
  // like "Re: Fwd: [Internal][External] Invitation: ..." all peel off.
  let prev: string;
  do {
    prev = s;
    s = s.replace(/^\s*(re|fwd?)\s*:\s*/i, '');
    s = s.replace(/^\s*[\[\(\{][^\]\)\}]*[\]\)\}]\s*/, '');
    s = s.replace(/^\s*(invitation|invitations|external|internal|confidential|fyi)\b[\s:,\-–|]*/i, '');
  } while (s !== prev);

  // Drop the same noise words anywhere in the title, as whole words.
  s = s.replace(/\b(invitation|invitations|external|internal|confidential|fyi)\b/gi, '');

  // Drop a leading preposition left behind when we stripped "Invitation to ..." etc.
  s = s.replace(/^\s*(to|for|at|on|re)\b\s+/i, '');

  // Collapse runs of stray separators (": -", "- :", " | ,") to one space.
  s = s.replace(/(\s*[\-–:|,]\s*){2,}/g, ' ');

  // Final whitespace + edge tidy.
  s = s.replace(/\s+/g, ' ').replace(/^[\s\-–:|,]+|[\s\-–:|,]+$/g, '').trim();
  return s || subject.trim();
}

function inferEventDetails(bodyText: string, subject: string, fallbackYear: number): {
  date_local: string | null;
  venue: string | null;
} {
  const text = `${subject}\n${bodyText}`;
  const d = extractDate(text, fallbackYear);
  const t = extractTime(text);
  const venue = extractVenue(text);

  let date_local: string | null = null;
  if (d) {
    const hour = t?.hour ?? 9; // default to 9am if no time found
    const minute = t?.minute ?? 0;
    date_local = toDateTimeLocal(d.year, d.month, d.day, hour, minute);
  }
  return { date_local, venue };
}

export default function NewEventPage() {
  const router = useRouter();
  const [query, setQuery] = useState('newer_than:30d');
  const [results, setResults] = useState<GmailMessageSummary[]>([]);
  const [picked, setPicked] = useState<GmailMessageSummary | null>(null);
  const [fullMessage, setFullMessage] = useState<FullMessage | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [sort, setSort] = useState<SortMode>('date_desc');
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [venue, setVenue] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [isPending, start] = useTransition();

  const search = (q?: string) => {
    const useQ = q ?? query;
    if (q !== undefined) setQuery(q);
    start(async () => {
      setErr(null);
      try { setResults(await searchInbox(useQ)); }
      catch (e) { setErr(e instanceof Error ? e.message : 'unknown'); }
    });
  };

  const sortedResults = useMemo(() => {
    const arr = [...results];
    switch (sort) {
      case 'date_desc': arr.sort((a, b) => b.internal_date - a.internal_date); break;
      case 'date_asc': arr.sort((a, b) => a.internal_date - b.internal_date); break;
      case 'subject_asc': arr.sort((a, b) => a.subject.localeCompare(b.subject)); break;
      case 'sender_asc': arr.sort((a, b) => senderName(a.from).localeCompare(senderName(b.from))); break;
    }
    return arr;
  }, [results, sort]);

  // Fetch the full body when picked changes
  useEffect(() => {
    if (!picked) { setFullMessage(null); return; }
    setPreviewLoading(true);
    let cancelled = false;
    (async () => {
      try {
        const m = await previewGmailMessage(picked.id);
        if (!cancelled) setFullMessage(m);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'preview failed');
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [picked]);

  // Reset and prefill name from subject every time the user picks a different
  // email (so switching emails re-syncs the form). Picking the same email
  // again is a no-op so an in-progress manual edit isn't clobbered.
  useEffect(() => {
    if (!picked) return;
    setName(cleanSubject(picked.subject));
    setDate('');
    setVenue('');
  }, [picked?.id]);

  // Once the full body loads for the currently-picked email, fill date + venue
  // from the body. Runs on every new email pick (overwrites prior inference).
  useEffect(() => {
    if (!fullMessage || !picked || fullMessage.id !== picked.id) return;
    const fallbackYear = new Date(picked.internal_date).getFullYear();
    const inferred = inferEventDetails(fullMessage.body_text, picked.subject, fallbackYear);
    if (inferred.date_local) setDate(inferred.date_local);
    if (inferred.venue) setVenue(inferred.venue);
  }, [fullMessage, picked]);

  const submit = () => {
    if (!picked) return;
    start(async () => {
      try {
        await createEventFromMessage({
          gmail_message_id: picked.id,
          name,
          event_date: date,
          venue: venue || undefined,
        });
        router.push(`/events`);
      } catch (e) { setErr(e instanceof Error ? e.message : 'unknown'); }
    });
  };

  return (
    <section className="max-w-6xl space-y-4">
      <h2 className="text-xl font-semibold">New event from Gmail</h2>

      <div className="space-y-2">
        <label className="block text-sm font-medium">Quick filters</label>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_FILTERS.map((f) => (
            <button
              key={f.label}
              onClick={() => search(f.query)}
              className={`rounded-full px-3 py-1 text-xs ${query === f.query ? 'bg-blue-600 text-white' : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'}`}
              type="button"
              title={f.query}
            >
              {f.label}
            </button>
          ))}
        </div>

        <label className="block text-sm font-medium pt-2">Search</label>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded border border-neutral-300 px-3 py-2 text-sm"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') search(); }}
            placeholder="e.g. subject:invitation newer_than:30d"
          />
          <button onClick={() => search()} disabled={isPending} className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {isPending ? 'Searching…' : 'Search'}
          </button>
        </div>
        <p className="text-xs text-neutral-500">
          Gmail operators work — <code>from:</code>, <code>subject:</code>, <code>has:attachment</code>, <code>before:2025/01/01</code>, <code>newer_than:14d</code>. Click a chip above to start.
        </p>
      </div>

      {err && <p className="rounded bg-red-50 p-3 text-sm text-red-700">{err}</p>}

      <div className="grid gap-4 md:grid-cols-2">
        {/* LEFT — Results list */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">
              Results <span className="text-xs font-normal text-neutral-500">({sortedResults.length})</span>
            </h3>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortMode)}
              className="rounded border border-neutral-300 px-2 py-1 text-xs"
            >
              <option value="date_desc">Newest first</option>
              <option value="date_asc">Oldest first</option>
              <option value="subject_asc">Subject A→Z</option>
              <option value="sender_asc">Sender A→Z</option>
            </select>
          </div>

          {sortedResults.length === 0 ? (
            <p className="rounded border border-dashed border-neutral-300 bg-neutral-50 p-4 text-center text-xs text-neutral-500">
              No results yet. Pick a quick filter or write a query.
            </p>
          ) : (
            <ul className="max-h-[600px] space-y-1 overflow-y-auto pr-1">
              {sortedResults.map((m) => {
                const isPicked = picked?.id === m.id;
                return (
                  <li
                    key={m.id}
                    onClick={() => setPicked(m)}
                    className={`cursor-pointer rounded border p-2 text-sm ${isPicked ? 'border-blue-500 bg-blue-50' : 'border-neutral-200 bg-white hover:bg-neutral-50'}`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate font-medium">{m.subject || '(no subject)'}</p>
                      <span className="flex-none text-xs text-neutral-500">{formatGmailDate(m.internal_date)}</span>
                    </div>
                    <p className="truncate text-xs text-neutral-600">{m.from}</p>
                    <p className="line-clamp-2 text-xs text-neutral-500">{m.snippet}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* RIGHT — Gmail-style preview */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Preview</h3>
          {!picked ? (
            <div className="rounded border border-dashed border-neutral-300 bg-neutral-50 p-6 text-center text-xs text-neutral-500">
              Pick a result on the left to preview it here.
            </div>
          ) : (
            <article className="rounded border border-neutral-200 bg-white">
              <header className="border-b border-neutral-200 p-3 space-y-2">
                <h4 className="text-base font-semibold leading-snug">{picked.subject || '(no subject)'}</h4>
                <div className="flex items-start gap-3">
                  <div className={`flex h-10 w-10 flex-none items-center justify-center rounded-full text-sm font-semibold ${avatarColor(picked.from)}`}>
                    {avatarLetter(picked.from)}
                  </div>
                  <div className="flex-1 text-xs">
                    <p className="text-sm font-medium text-neutral-900">{picked.from}</p>
                    <p className="text-neutral-500">to me · {formatGmailDate(picked.internal_date)}</p>
                  </div>
                </div>
              </header>
              <div className="max-h-[500px] overflow-y-auto p-4 text-sm leading-relaxed">
                {previewLoading ? (
                  <p className="text-xs text-neutral-500">Loading…</p>
                ) : fullMessage ? (
                  <pre className="whitespace-pre-wrap break-words font-sans">{fullMessage.body_text || picked.snippet}</pre>
                ) : (
                  <pre className="whitespace-pre-wrap break-words font-sans text-neutral-500">{picked.snippet}</pre>
                )}
              </div>
            </article>
          )}
        </div>
      </div>

      {picked && (
        <div className="space-y-2 rounded border border-neutral-200 bg-white p-3">
          <h3 className="text-sm font-semibold">Event details</h3>
          <p className="text-xs text-neutral-500">
            The email body above is cached as the formal EDM reference; the LLM uses it when drafting WhatsApp invitations.
          </p>
          <label className="block text-xs">
            <span className="font-medium">Event name</span>
            <input className="mt-0.5 w-full rounded border border-neutral-300 px-3 py-2 text-sm" placeholder="Event name" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block text-xs">
            <span className="font-medium">Date & time</span>
            <input type="datetime-local" className="mt-0.5 w-full rounded border border-neutral-300 px-3 py-2 text-sm" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="block text-xs">
            <span className="font-medium">Venue (optional)</span>
            <input className="mt-0.5 w-full rounded border border-neutral-300 px-3 py-2 text-sm" placeholder="Venue" value={venue} onChange={(e) => setVenue(e.target.value)} />
          </label>
          <button onClick={submit} disabled={isPending || !name || !date} className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {isPending ? 'Creating…' : 'Create event'}
          </button>
        </div>
      )}
    </section>
  );
}
