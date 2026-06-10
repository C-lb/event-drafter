import Link from 'next/link';
import { listEvents } from './actions';

export const dynamic = 'force-dynamic';

export default async function EventsPage() {
  const all = await listEvents();
  return (
    <section className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Events</h2>
        <Link href="/events/new" className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white">
          Create from Gmail
        </Link>
      </div>
      {all.length === 0 ? (
        <p className="text-sm text-neutral-600">No events yet.</p>
      ) : (
        <ul className="space-y-2">
          {all.map((e) => (
            <li key={e.id} className="rounded border border-neutral-200 bg-white p-3">
              <p className="font-medium">
                <Link href={`/events/${e.id}`} className="hover:underline">{e.name}</Link>
              </p>
              <p className="text-xs text-neutral-600">
                {new Date(e.event_date).toLocaleString()} · {e.venue ?? '—'} · {e.status}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
