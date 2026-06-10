import Link from 'next/link';
import { listEventsWithStats } from './actions';

export const dynamic = 'force-dynamic';

function daysUntil(date: Date | string | number): { days: number; label: string; expired: boolean } {
  const target = new Date(date);
  const target0 = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const now = new Date();
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((target0.getTime() - today0.getTime()) / 86_400_000);
  if (days < 0) return { days, label: `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`, expired: true };
  if (days === 0) return { days, label: 'today', expired: false };
  if (days === 1) return { days, label: 'tomorrow', expired: false };
  return { days, label: `in ${days} days`, expired: false };
}

export default async function EventsPage() {
  const all = await listEventsWithStats();
  const upcoming = all.filter((e) => !daysUntil(e.event_date).expired);
  const past = all.filter((e) => daysUntil(e.event_date).expired);

  return (
    <section className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Events</h2>
        <Link href="/events/new" className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white">
          Create from Gmail
        </Link>
      </div>

      {all.length === 0 ? (
        <p className="text-sm text-neutral-600">No events yet.</p>
      ) : (
        <>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-neutral-700">
              Upcoming ({upcoming.length})
            </h3>
            {upcoming.length === 0 ? (
              <p className="text-xs text-neutral-500">No upcoming events.</p>
            ) : (
              <ul className="space-y-2">
                {upcoming.map((e) => <EventCard key={e.id} ev={e} expired={false} />)}
              </ul>
            )}
          </div>

          {past.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-neutral-500">
                Past ({past.length})
              </h3>
              <ul className="space-y-2">
                {past.map((e) => <EventCard key={e.id} ev={e} expired={true} />)}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}

interface CardEvent {
  id: number;
  name: string;
  event_date: Date | string;
  venue: string | null;
  status: string;
  total_invites: number;
  sent_invites: number;
  replied: number;
  not_replied: number;
}

function EventCard({ ev, expired }: { ev: CardEvent; expired: boolean }) {
  const { label } = daysUntil(ev.event_date);
  const wrapperCls = expired
    ? 'rounded border border-neutral-200 bg-neutral-50 p-3 opacity-70'
    : 'rounded border border-neutral-200 bg-white p-3';
  const dateBadgeCls = expired
    ? 'rounded bg-neutral-200 px-2 py-0.5 text-xs text-neutral-600'
    : 'rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800';

  return (
    <li className={wrapperCls}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-medium">
          <Link href={`/events/${ev.id}`} className="hover:underline">{ev.name}</Link>
        </p>
        <span className={dateBadgeCls}>{label}</span>
      </div>
      <p className="mt-0.5 text-xs text-neutral-600">
        {new Date(ev.event_date).toLocaleString()} · {ev.venue ?? '—'} · {ev.status}
      </p>
      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        <span className="rounded bg-neutral-100 px-2 py-0.5">
          {ev.total_invites} invited · {ev.sent_invites} sent
        </span>
        <span className={`rounded px-2 py-0.5 ${ev.replied > 0 ? 'bg-green-100 text-green-800' : 'bg-neutral-100 text-neutral-600'}`}>
          {ev.replied} replied
        </span>
        <span className={`rounded px-2 py-0.5 ${ev.not_replied > 0 ? 'bg-amber-100 text-amber-800' : 'bg-neutral-100 text-neutral-600'}`}>
          {ev.not_replied} no reply
        </span>
      </div>
    </li>
  );
}
