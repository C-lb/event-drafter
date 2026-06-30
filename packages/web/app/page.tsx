import Link from 'next/link';
import { getDb } from '@/lib/db';
import { contacts, replies } from '@event-drafter/core/schema';
import { eq, sql } from 'drizzle-orm';
import { listEventsWithStats } from './events/actions';
import { listAllReplies, triggerReplyCheck } from './replies/actions';
import { enqueueImport } from './setup/import/actions';
import { EventStickyCard, type StickyEvent } from './EventStickyCard';
import { RefreshButton } from './RefreshButton';

export const dynamic = 'force-dynamic';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

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
  const replyCount = db.select({ count: sql<number>`count(*)` }).from(replies).where(eq(replies.resolved, false)).all()[0]?.count ?? 0;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
  const nowMs = now.getTime();

  const allEvents = await listEventsWithStats();
  // Events dated within the current calendar month. Upcoming events first
  // (soonest at the top); past events sink below, most recent first.
  const thisMonth = allEvents
    .map((e) => ({ ...e, ms: new Date(e.event_date).getTime() }))
    .filter((e) => e.ms >= monthStart && e.ms < monthEnd)
    .sort((a, b) => {
      const aPast = a.ms < nowMs;
      const bPast = b.ms < nowMs;
      if (aPast !== bPast) return aPast ? 1 : -1; // past sinks below upcoming
      return aPast ? b.ms - a.ms : a.ms - b.ms; // upcoming asc, past desc
    });

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

  const preview = thisMonth.slice(0, 3);

  return (
    <section className="space-y-8">
      <div className="grid grid-cols-3 items-stretch gap-4">
        {/* Contacts: count + view / refresh icon buttons */}
        <div className="card flex flex-col p-5">
          <p className="eyebrow">Contacts</p>
          <p className="mt-2 text-3xl font-semibold tracking-tight">{contactCount}</p>
          <div className="mt-auto flex items-center gap-2 pt-4">
            <Link href="/contacts" className="btn btn-sm px-2" title="View contacts" aria-label="View contacts">
              <EyeIcon />
            </Link>
            <RefreshButton action={refreshContacts} title="Re-sync contacts from the Sheet" />
          </div>
        </div>

        {/* Events: compact preview of this month's events */}
        <div className="card flex flex-col p-5">
          <div className="flex items-baseline justify-between">
            <p className="eyebrow">Events</p>
            <Link href="/events" className="text-xs font-medium text-accent hover:text-accent-hover">All</Link>
          </div>
          {preview.length === 0 ? (
            <p className="mt-3 text-sm text-ink-3">No events this month.</p>
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

        {/* Unread replies: count + view all / refresh */}
        <div className="card flex flex-col p-5">
          <p className="eyebrow">Unread replies</p>
          <p className="mt-2 text-3xl font-semibold tracking-tight">{replyCount}</p>
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
          <h3 className="text-base font-semibold">Events this month</h3>
          <span className="text-sm text-ink-3">{MONTHS[now.getMonth()]} {now.getFullYear()}</span>
        </div>
        {thisMonth.length === 0 ? (
          <p className="card p-5 text-sm text-ink-2">
            No events this month.{' '}
            <Link href="/events/new" className="font-medium text-accent hover:text-accent-hover">Create from Gmail</Link>
            {' '}or{' '}
            <Link href="/events/new/blank" className="font-medium text-accent hover:text-accent-hover">create a blank one</Link>.
          </p>
        ) : (
          <ul className="space-y-3">
            {thisMonth.map((e) => {
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
