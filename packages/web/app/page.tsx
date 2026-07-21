import Link from 'next/link';
import { getDb } from '@/lib/db';
import { events, contacts, replies } from '@event-drafter/core/schema';
import { getSetting } from '@event-drafter/core/settings';
import { desc, eq, sql } from 'drizzle-orm';
import { listEventsWithStats } from './events/actions';
import { listAllReplies, triggerReplyCheck, setReplyResolved } from './replies/actions';
import { enqueueImport } from './setup/import/actions';
import { EventStickyCard, type StickyEvent } from './EventStickyCard';
import { RefreshButton } from './RefreshButton';
import { ResolveButton } from './ResolveButton';

export const dynamic = 'force-dynamic';

function snippet(text: string, n = 90): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

function classBadge(c: string | null): string {
  switch (c) {
    case 'yes': return 'badge badge-green';
    case 'no': return 'badge badge-red';
    case 'maybe': return 'badge badge-amber';
    default: return 'badge badge-neutral';
  }
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtShort(ms: number): string {
  const d = new Date(ms);
  let h = d.getHours();
  const ap = h < 12 ? 'am' : 'pm';
  h = h % 12 || 12;
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${MON[d.getMonth()]} ${d.getDate()}, ${h}:${mm}${ap}`;
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-[1.05em] w-[1.05em] flex-none" aria-hidden>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export default async function HomePage() {
  const db = getDb();
  const contactCount = db.select({ count: sql<number>`count(*)` }).from(contacts).all()[0]?.count ?? 0;
  const eventCount = db.select({ count: sql<number>`count(*)` }).from(events).all()[0]?.count ?? 0;
  const replyCount = db.select({ count: sql<number>`count(*)` }).from(replies).where(eq(replies.resolved, false)).all()[0]?.count ?? 0;

  const recentContacts = db
    .select({ id: contacts.id, first_name: contacts.first_name, last_name: contacts.last_name, phone_e164: contacts.phone_e164 })
    .from(contacts)
    .orderBy(desc(contacts.created_at))
    .limit(20)
    .all();

  // The bound sheet only stores its id; the title lives on the matching
  // history entry recorded when it was picked.
  const contactsSheet = getSetting('contacts_sheet');
  const sheetHistory = getSetting('sheet_history') ?? [];
  const contactsSheetTitle = contactsSheet
    ? sheetHistory.find((h) => h.spreadsheet_id === contactsSheet.spreadsheet_id)?.title
    : undefined;

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const nowMs = now.getTime();

  const allEvents = await listEventsWithStats();
  // All upcoming events (dated today or later), soonest first.
  const upcoming = allEvents
    .map((e) => ({ ...e, ms: new Date(e.event_date).getTime() }))
    .filter((e) => e.ms >= todayStart)
    .sort((a, b) => a.ms - b.ms);

  // Unread (unresolved) replies, grouped under their event.
  const unread = await listAllReplies({ includeResolved: false });
  const groups = new Map<number, { event_id: number; event_name: string; rows: typeof unread }>();
  for (const r of unread) {
    let g = groups.get(r.event_id);
    if (!g) {
      g = { event_id: r.event_id, event_name: r.event_name, rows: [] };
      groups.set(r.event_id, g);
    }
    g.rows.push(r);
  }
  const replyGroups = [...groups.values()];

  // Server actions for the top-row refresh buttons.
  async function refreshContacts() {
    'use server';
    await enqueueImport();
  }
  async function refreshReplies() {
    'use server';
    await triggerReplyCheck();
  }

  const preview = upcoming.slice(0, 3);

  return (
    <section className="space-y-8">
      <div className="grid grid-cols-3 items-stretch gap-4">
        {/* Contacts: recently imported preview + view / update icon buttons */}
        <div className="card flex flex-col p-5">
          <div className="flex items-baseline justify-between gap-2">
            <p className="eyebrow truncate">
              Contacts{contactsSheetTitle ? ` · ${contactsSheetTitle}` : ''}
            </p>
            <span className="flex-none text-xs font-medium text-ink-3">{contactCount} total</span>
          </div>
          {recentContacts.length === 0 ? (
            <p className="mt-3 text-sm text-ink-3">No contacts imported yet.</p>
          ) : (
            <ul className="mt-3 max-h-40 space-y-2 overflow-y-auto">
              {recentContacts.map((c) => (
                <li key={c.id} className="flex items-baseline justify-between gap-3 rounded-sm px-2 py-1.5">
                  <span className="truncate text-sm font-medium">
                    {c.first_name}{c.last_name ? ` ${c.last_name}` : ''}
                  </span>
                  <span className="flex-none text-xs text-ink-3">{c.phone_e164}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-auto flex items-center gap-2 pt-4">
            <Link href="/contacts" className="btn btn-sm px-2" title="View contacts" aria-label="View contacts">
              <EyeIcon />
            </Link>
            <RefreshButton action={refreshContacts} title="Re-sync contacts from the Sheet" label="Update" />
          </div>
        </div>

        {/* Events: compact preview of this month's events */}
        <div className="card flex flex-col p-5">
          <div className="flex items-baseline justify-between">
            <p className="eyebrow">Events</p>
            <Link href="/events" className="text-xs font-medium text-accent hover:text-accent-hover">All</Link>
          </div>
          {preview.length === 0 ? (
            <p className="mt-3 text-sm text-ink-3">No upcoming events.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {preview.map((e) => (
                <li key={e.id}>
                  <Link
                    href={`/events/${e.id}`}
                    className="flex items-baseline justify-between gap-3 rounded-sm px-2 py-1.5 hover:bg-surface-2"
                  >
                    <span className="truncate text-sm font-medium">{e.name}</span>
                    <span className="flex-none text-xs text-ink-3" suppressHydrationWarning>{fmtShort(e.ms)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Unread replies: per-event breakdown + view all / refresh */}
        <div className="card flex flex-col p-5">
          <div className="flex items-baseline justify-between">
            <p className="eyebrow">Unread replies</p>
            <span className="text-xs font-medium text-ink-3">{replyCount} total</span>
          </div>
          {replyGroups.length === 0 ? (
            <p className="mt-3 text-sm text-ink-3">No unread replies.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {replyGroups.slice(0, 3).map((g) => (
                <li key={g.event_id}>
                  <Link
                    href={`/events/${g.event_id}/replies`}
                    className="flex items-baseline justify-between gap-3 rounded-sm px-2 py-1.5 hover:bg-surface-2"
                  >
                    <span className="truncate text-sm font-medium">{g.event_name}</span>
                    <span className="flex-none text-sm tabular-nums text-ink-2">{g.rows.length}</span>
                  </Link>
                </li>
              ))}
              {replyGroups.length > 3 && (
                <li className="px-2 text-xs text-ink-3">+{replyGroups.length - 3} more events</li>
              )}
            </ul>
          )}
          <div className="mt-auto flex items-center gap-2 pt-4">
            <Link href="/replies" className="btn btn-sm px-2" title="View all replies" aria-label="View all replies">
              <EyeIcon />
            </Link>
            <RefreshButton action={refreshReplies} title="Check for new replies" />
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h3 className="text-base font-semibold">Upcoming events</h3>
          <span className="text-sm text-ink-3">{upcoming.length} scheduled</span>
        </div>
        {upcoming.length === 0 ? (
          <p className="card p-5 text-sm text-ink-2">
            No upcoming events.{' '}
            <Link href="/events/new" className="font-medium text-accent hover:text-accent-hover">Create from Gmail</Link>
            {' '}or{' '}
            <Link href="/events/new/blank" className="font-medium text-accent hover:text-accent-hover">create a blank one</Link>.
          </p>
        ) : (
          <ul className="space-y-3">
            {upcoming.map((e) => {
              const sticky: StickyEvent = {
                id: e.id,
                name: e.name,
                note: e.note ?? null,
                event_date_ms: e.ms,
                venue: e.venue ?? null,
                total_invites: e.total_invites,
                replied: e.replied,
                yes: e.yes,
                no: e.no,
                maybe: e.maybe,
                unclear: e.unclear,
              };
              return <EventStickyCard key={e.id} ev={sticky} isPast={e.ms < nowMs} />;
            })}
          </ul>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h3 className="text-base font-semibold">Unread replies</h3>
          <Link href="/replies" className="text-sm font-medium text-accent hover:text-accent-hover">All replies</Link>
        </div>
        {replyGroups.length === 0 ? (
          <p className="card-quiet p-5 text-sm text-ink-2">No unread replies. You are all caught up.</p>
        ) : (
          <div className="space-y-5">
            {replyGroups.map((g) => (
              <div key={g.event_id} className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <p className="eyebrow">{g.event_name}</p>
                  <Link href={`/events/${g.event_id}/replies`} className="text-xs font-medium text-accent hover:text-accent-hover">
                    {g.rows.length} to review
                  </Link>
                </div>
                <ul className="space-y-2">
                  {g.rows.map((r) => (
                    <li key={r.reply_id} className="card flex flex-wrap items-center gap-x-3 gap-y-1 p-4">
                      <span className="font-medium">{r.contact_name}</span>
                      <span className={classBadge(r.classification)}>{r.classification ?? 'unclassified'}</span>
                      <span className="min-w-0 flex-1 truncate text-sm text-ink-2">{snippet(r.reply_text)}</span>
                      <ResolveButton replyId={r.reply_id} action={setReplyResolved} />
                      <Link
                        href={`/events/${g.event_id}/replies`}
                        className="btn btn-sm flex-none"
                      >
                        Review
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-sm text-ink-2">
        First time here? <Link href="/setup" className="font-medium text-accent hover:text-accent-hover">Run setup</Link>.
      </p>
    </section>
  );
}
