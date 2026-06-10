import Link from 'next/link';
import { getDb } from '@/lib/db';
import { jobs, events, contacts, replies } from '@vip/core/schema';
import { sql } from 'drizzle-orm';
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
  const jobStatusRows = db
    .select({ status: jobs.status, count: sql<number>`count(*)` })
    .from(jobs)
    .groupBy(jobs.status)
    .all();
  const jobBy: { queued: number; running: number; succeeded: number; failed: number } = {
    queued: 0, running: 0, succeeded: 0, failed: 0,
  };
  for (const r of jobStatusRows) {
    if (r.status in jobBy) jobBy[r.status as keyof typeof jobBy] = Number(r.count);
  }
  const jobActive = jobBy.queued + jobBy.running;
  const contactCount = db.select({ count: sql<number>`count(*)` }).from(contacts).all()[0]?.count ?? 0;
  const eventCount = db.select({ count: sql<number>`count(*)` }).from(events).all()[0]?.count ?? 0;
  const replyCount = db.select({ count: sql<number>`count(*)` }).from(replies).all()[0]?.count ?? 0;

  const allEvents = await listEventsWithStats();
  const upcoming = allEvents
    .map((e) => ({ ev: e, meta: daysUntil(e.event_date) }))
    .filter((r) => !r.meta.expired)
    .sort((a, b) => a.meta.days - b.meta.days)
    .slice(0, 5);

  return (
    <section className="space-y-6">
      <div className="grid grid-cols-4 gap-3">
        <Link href="/contacts" className="rounded border border-neutral-200 bg-white p-3 hover:bg-neutral-50">
          <p className="text-xs text-neutral-500">Contacts</p>
          <p className="text-2xl font-semibold">{contactCount}</p>
        </Link>
        <Link href="/events" className="rounded border border-neutral-200 bg-white p-3 hover:bg-neutral-50">
          <p className="text-xs text-neutral-500">Events</p>
          <p className="text-2xl font-semibold">{eventCount}</p>
        </Link>
        <Link href="/replies" className="rounded border border-neutral-200 bg-white p-3 hover:bg-neutral-50">
          <p className="text-xs text-neutral-500">Replies</p>
          <p className="text-2xl font-semibold">{replyCount}</p>
        </Link>
        <Link href="/status" className="rounded border border-neutral-200 bg-white p-3 hover:bg-neutral-50">
          <p className="text-xs text-neutral-500">Jobs (active / failed)</p>
          <p className="text-2xl font-semibold">
            {jobActive}
            <span className={`ml-2 text-base ${jobBy.failed > 0 ? 'text-red-700' : 'text-neutral-400'}`}>
              / {jobBy.failed}
            </span>
          </p>
        </Link>
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold text-neutral-700">Upcoming events</h3>
          <Link href="/events" className="text-xs text-neutral-500 hover:underline">All events →</Link>
        </div>
        {upcoming.length === 0 ? (
          <p className="rounded border border-neutral-200 bg-white p-3 text-sm text-neutral-600">
            No upcoming events.{' '}
            <Link href="/events/new" className="text-blue-700 underline">Create one from Gmail</Link>.
          </p>
        ) : (
          <ul className="space-y-2">
            {upcoming.map(({ ev, meta }) => {
              const badgeCls = meta.urgent
                ? 'rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800'
                : 'rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800';
              return (
                <li key={ev.id} className="rounded border border-neutral-200 bg-white p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <Link href={`/events/${ev.id}`} className="font-medium hover:underline">{ev.name}</Link>
                    <span className={badgeCls}>{meta.label}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-neutral-600">
                    {new Date(ev.event_date).toLocaleString()} · {ev.venue ?? '—'}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                    <span className="rounded bg-neutral-100 px-2 py-0.5">{ev.total_invites} invited · {ev.sent_invites} sent</span>
                    <span className={`rounded px-2 py-0.5 ${ev.replied > 0 ? 'bg-green-100 text-green-800' : 'bg-neutral-100 text-neutral-600'}`}>
                      {ev.replied} replied
                    </span>
                    <span className={`rounded px-2 py-0.5 ${ev.not_replied > 0 ? 'bg-amber-100 text-amber-800' : 'bg-neutral-100 text-neutral-600'}`}>
                      {ev.not_replied} no reply
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="text-sm text-neutral-600">
        First time? <Link href="/setup" className="underline">Run setup</Link>.
      </p>
    </section>
  );
}
