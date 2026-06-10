import Link from 'next/link';
import { getEventOrThrow, listInvitesForEvent, triggerReplyCheck, listRepliesForEvent } from './actions';

export const dynamic = 'force-dynamic';

export default async function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const eventId = Number(id);
  const event = await getEventOrThrow(eventId);
  const invitesList = await listInvitesForEvent(eventId);
  const allReplies = await listRepliesForEvent(eventId);

  const counts = {
    total: invitesList.length,
    drafted: invitesList.filter((i) => i.status === 'drafted').length,
    approved: invitesList.filter((i) => i.status === 'approved').length,
    sent: invitesList.filter((i) => i.status === 'sent').length,
    skipped: invitesList.filter((i) => i.status === 'skipped').length,
    failed: invitesList.filter((i) => i.status === 'failed').length,
  };

  const replyCounts = {
    yes: allReplies.filter((r) => r.classification === 'yes').length,
    no: allReplies.filter((r) => r.classification === 'no').length,
    maybe: allReplies.filter((r) => r.classification === 'maybe').length,
    unclear: allReplies.filter((r) => r.classification === 'unclear').length,
  };

  async function check() {
    'use server';
    await triggerReplyCheck();
  }

  return (
    <section className="max-w-3xl space-y-4">
      <div className="space-y-1">
        <Link href="/events" className="text-xs text-neutral-500 hover:underline">← Events</Link>
        <h2 className="text-xl font-semibold">{event.name}</h2>
        <p className="text-xs text-neutral-600">
          {new Date(event.event_date).toLocaleString()} · {event.venue ?? '—'} · {event.status}
        </p>
      </div>

      <div className="grid grid-cols-6 gap-2 text-center text-xs">
        {(['total', 'drafted', 'approved', 'sent', 'skipped', 'failed'] as const).map((k) => (
          <div key={k} className="rounded border border-neutral-200 bg-white p-2">
            <p className="text-neutral-500">{k}</p>
            <p className="text-lg font-semibold">{counts[k]}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-4 gap-2 text-center text-xs">
        <div className="rounded border border-green-200 bg-green-50 p-2"><p>Yes</p><p className="text-lg font-semibold">{replyCounts.yes}</p></div>
        <div className="rounded border border-red-200 bg-red-50 p-2"><p>No</p><p className="text-lg font-semibold">{replyCounts.no}</p></div>
        <div className="rounded border border-yellow-200 bg-yellow-50 p-2"><p>Maybe</p><p className="text-lg font-semibold">{replyCounts.maybe}</p></div>
        <div className="rounded border border-neutral-200 bg-neutral-50 p-2"><p>Unclear</p><p className="text-lg font-semibold">{replyCounts.unclear}</p></div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link href={`/events/${eventId}/pick-contacts`} className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white">
          Add contacts &amp; generate drafts
        </Link>
        <Link href={`/events/${eventId}/queue`} className="rounded border border-neutral-300 px-4 py-2 text-sm">
          Review queue ({counts.drafted + counts.approved})
        </Link>
        <Link href={`/events/${eventId}/replies`} className="rounded border border-neutral-300 px-4 py-2 text-sm">
          Replies ({allReplies.length})
        </Link>
        <form action={check}>
          <button type="submit" className="rounded border border-neutral-300 px-4 py-2 text-sm">
            Check replies now
          </button>
        </form>
      </div>
    </section>
  );
}
