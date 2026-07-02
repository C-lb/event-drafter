import Link from 'next/link';
import { listEventsWithStats } from '../../events/actions';

export const dynamic = 'force-dynamic';

export default async function NewFollowUpPage() {
  const events = await listEventsWithStats();
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <p className="eyebrow">Follow up</p>
        <h2 className="text-2xl font-semibold tracking-tight">Pick an event</h2>
        <p className="text-sm text-ink-2">Choose the event you want to follow up on.</p>
      </div>

      {events.length === 0 ? (
        <p className="card-quiet p-6 text-center text-sm text-ink-2">
          No events yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {events.map((e) => (
            <li key={e.id}>
              <Link
                href={`/events/${e.id}/follow-up`}
                className="card flex items-center justify-between gap-3 p-4 hover:border-accent-line"
              >
                <span className="font-medium">{e.name}</span>
                <span className="badge badge-neutral">{e.total_invites} invited</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
