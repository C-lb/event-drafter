import Link from 'next/link';
import {
  getEventOrThrow,
  listInvitesForEvent,
  triggerReplyCheck,
  listRepliesForEvent,
  getEventRsvpSummary,
} from './actions';
import { latestReplyCheck, maybeEnqueueAutoReplyCheck } from '../../replies/actions';
import { EventEditPanel } from './EventEditPanel';
import { SummaryPanel } from './SummaryPanel';
import { RsvpSummarySection } from './RsvpSummary';
import { StarterDrafts } from './StarterDrafts';
import { AutoRefresh } from '../../components/AutoRefresh';
import { extractEdmSummary } from '@vip/core/edm-extract';
import { renderStarterDrafts } from '@vip/core/edm-templates';

export const dynamic = 'force-dynamic';

export default async function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const eventId = Number(id);
  // Same auto-trigger as /replies: if the last check finished more than 30
  // min ago, enqueue one so this page's RSVP summary picks up any newer
  // messages from previously-replied contacts.
  await maybeEnqueueAutoReplyCheck();

  const event = await getEventOrThrow(eventId);
  const invitesList = await listInvitesForEvent(eventId);
  const allReplies = await listRepliesForEvent(eventId);
  const rsvpSummary = await getEventRsvpSummary(eventId);
  const lastCheck = await latestReplyCheck();
  const checkInFlight = lastCheck?.status === 'queued' || lastCheck?.status === 'running';

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

  // Build starter drafts from the stored summary; fall back to a fresh
  // heuristic pass over the EDM body if no summary is persisted yet.
  const eventDate = event.event_date instanceof Date ? event.event_date : new Date(event.event_date);
  const fallbackYear = eventDate.getFullYear();
  const summaryStruct = event.edm_summary
    ? extractEdmSummary(event.edm_summary, event.edm_subject ?? '', fallbackYear)
    : extractEdmSummary(event.edm_body ?? '', event.edm_subject ?? '', fallbackYear);
  // Override the venue from the canonical event row when present — the
  // event row's venue field is authoritative.
  if (event.venue && !summaryStruct.venue) summaryStruct.venue = event.venue;
  const starterDrafts = renderStarterDrafts({
    event_name: event.name,
    event_date: eventDate,
    summary: summaryStruct,
    operator_first_name: 'Sara',
    operator_role: 'Community Manager @ SPARK',
  });

  return (
    <section className="max-w-7xl space-y-4">
      <AutoRefresh active={checkInFlight} />
      <div className="space-y-1">
        <Link href="/events" className="text-xs text-neutral-500 hover:underline">← Events</Link>
        <h2 className="text-3xl font-semibold tracking-tight">{event.name}</h2>
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
          <button
            type="submit"
            disabled={checkInFlight}
            className="rounded border border-neutral-300 px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
          >
            {checkInFlight ? 'Checking…' : 'Check replies now'}
          </button>
        </form>
        {checkInFlight && (
          <span className="self-center text-xs text-neutral-600">
            worker running — page will refresh automatically
          </span>
        )}
      </div>

      {/* Two-column split on wide monitors: RSVP roster on the left, EDM
          context + starter drafts stacked on the right. Stacks vertically
          below the `lg` breakpoint (1024px viewport). */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <RsvpSummarySection data={rsvpSummary} />
        </div>
        <div className="space-y-4">
          <SummaryPanel
            event={{
              id: event.id,
              name: event.name,
              event_date: event.event_date as Date,
              venue: event.venue ?? null,
              edm_subject: event.edm_subject ?? null,
              edm_body: event.edm_body ?? null,
              edm_summary: event.edm_summary ?? null,
            }}
          />
          <StarterDrafts
            eventId={event.id}
            drafts={starterDrafts}
            overrides={(event.draft_overrides as Partial<Record<string, string>>) ?? {}}
          />
        </div>
      </div>

      <EventEditPanel
        event={{
          id: event.id,
          name: event.name,
          event_date: event.event_date as Date,
          venue: event.venue ?? null,
          edm_subject: event.edm_subject ?? null,
          edm_body: event.edm_body ?? null,
          edm_summary: event.edm_summary ?? null,
        }}
      />
    </section>
  );
}
