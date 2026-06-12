import Link from 'next/link';
import { listEventsWithStats } from './actions';
import { EventCard } from './EventCard';

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
    <section className="max-w-7xl space-y-6">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-3xl font-semibold tracking-tight">Events</h2>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/events/new"
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Create from Gmail
          </Link>
          <Link
            href="/events/new/blank"
            className="rounded border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
          >
            Create blank
          </Link>
        </div>
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
                {upcoming.map((e) => (
                  <EventCard
                    key={e.id}
                    ev={{
                      id: e.id,
                      name: e.name,
                      event_date: e.event_date as Date,
                      venue: e.venue ?? null,
                      status: e.status,
                      total_invites: e.total_invites,
                      replied: e.replied,
                      yes: e.yes,
                      no: e.no,
                      maybe: e.maybe,
                      unclear: e.unclear,
                    }}
                    expired={false}
                    dateLabel={daysUntil(e.event_date).label}
                  />
                ))}
              </ul>
            )}
          </div>

          {past.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-neutral-500">
                Past ({past.length})
              </h3>
              <ul className="space-y-2">
                {past.map((e) => (
                  <EventCard
                    key={e.id}
                    ev={{
                      id: e.id,
                      name: e.name,
                      event_date: e.event_date as Date,
                      venue: e.venue ?? null,
                      status: e.status,
                      total_invites: e.total_invites,
                      replied: e.replied,
                      yes: e.yes,
                      no: e.no,
                      maybe: e.maybe,
                      unclear: e.unclear,
                    }}
                    expired={true}
                    dateLabel={daysUntil(e.event_date).label}
                  />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
