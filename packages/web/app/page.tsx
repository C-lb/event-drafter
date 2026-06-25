import Link from 'next/link';
import { getDb } from '@/lib/db';
import { events, contacts, replies } from '@event-drafter/core/schema';
import { eq, sql } from 'drizzle-orm';
import { listEventsWithStats } from './events/actions';

export const dynamic = 'force-dynamic';

function daysUntil(date: Date | string | number): { days: number; label: string; expired: boolean; urgent: boolean } {
  const target = new Date(date);
  const target0 = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const now = new Date();
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((target0.getTime() - today0.getTime()) / 86_400_000);
  const expired = days < 0;
  let label: string;
  if (expired) label = `${Math.abs(days)}d ago`;
  else if (days === 0) label = 'today';
  else if (days === 1) label = 'tomorrow';
  else label = `in ${days} days`;
  return { days, label, expired, urgent: !expired && days <= 7 };
}

export default async function HomePage() {
  const db = getDb();
  const contactCount = db.select({ count: sql<number>`count(*)` }).from(contacts).all()[0]?.count ?? 0;
  const eventCount = db.select({ count: sql<number>`count(*)` }).from(events).all()[0]?.count ?? 0;
  const replyCount = db.select({ count: sql<number>`count(*)` }).from(replies).where(eq(replies.resolved, false)).all()[0]?.count ?? 0;

  const allEvents = await listEventsWithStats();
  const upcoming = allEvents
    .map((e) => ({ ev: e, meta: daysUntil(e.event_date) }))
    .filter((r) => !r.meta.expired)
    .sort((a, b) => a.meta.days - b.meta.days)
    .slice(0, 5);

  const stats = [
    { href: '/contacts', label: 'Contacts', value: contactCount },
    { href: '/events', label: 'Events', value: eventCount },
    { href: '/replies', label: 'Unread replies', value: replyCount },
  ];

  return (
    <section className="space-y-8">
      <div className="grid grid-cols-3 gap-4">
        {stats.map((s) => (
          <Link key={s.href} href={s.href} className="card p-5 transition hover:-translate-y-0.5">
            <p className="eyebrow">{s.label}</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight">{s.value}</p>
          </Link>
        ))}
      </div>

      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h3 className="text-base font-semibold">Upcoming events</h3>
          <Link href="/events" className="text-sm font-medium text-accent hover:text-accent-hover">All events</Link>
        </div>
        {upcoming.length === 0 ? (
          <p className="card p-5 text-sm text-ink-2">
            No upcoming events yet.{' '}
            <Link href="/events/new" className="font-medium text-accent hover:text-accent-hover">Create from Gmail</Link>
            {' '}or{' '}
            <Link href="/events/new/blank" className="font-medium text-accent hover:text-accent-hover">create a blank one</Link>.
          </p>
        ) : (
          <ul className="space-y-3">
            {upcoming.map(({ ev, meta }) => (
              <li key={ev.id} className="card p-5">
                <div className="flex items-baseline justify-between gap-2">
                  <Link href={`/events/${ev.id}`} className="font-semibold hover:text-accent">{ev.name}</Link>
                  <span className={`badge ${meta.urgent ? 'badge-amber' : 'badge-blue'}`}>{meta.label}</span>
                </div>
                <p className="mt-1 text-sm text-ink-2">
                  {new Date(ev.event_date).toLocaleString()} · {ev.venue ?? 'No venue set'}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <span className="badge badge-neutral">{ev.total_invites} invited</span>
                  <span className={`badge ${ev.replied > 0 ? 'badge-blue' : 'badge-neutral'}`}>{ev.replied} replied</span>
                  <span className={`badge ${ev.yes > 0 ? 'badge-green' : 'badge-neutral'}`}>{ev.yes} yes</span>
                  <span className={`badge ${ev.no > 0 ? 'badge-red' : 'badge-neutral'}`}>{ev.no} no</span>
                  <span className={`badge ${ev.maybe > 0 ? 'badge-amber' : 'badge-neutral'}`}>{ev.maybe} maybe</span>
                  <span className="badge badge-neutral">{ev.unclear} unclear</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-sm text-ink-2">
        First time here? <Link href="/setup" className="font-medium text-accent hover:text-accent-hover">Run setup</Link>.
      </p>
    </section>
  );
}
