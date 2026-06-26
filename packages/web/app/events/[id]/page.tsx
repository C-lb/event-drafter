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
import { DelegateSheetField } from './DelegateSheetField';
import { StarterDrafts } from './StarterDrafts';
import { AutoRefresh } from '../../components/AutoRefresh';
import { extractEdmSummary } from '@event-drafter/core/edm-extract';
import { renderStarterDrafts } from '@event-drafter/core/edm-templates';

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
    <section className="space-y-6">
      <AutoRefresh active={checkInFlight} />
      <div className="space-y-1">
        <Link href="/events" className="text-xs font-medium text-accent hover:text-accent-hover">← Events</Link>
        <h2 className="text-2xl font-semibold tracking-tight">{event.name}</h2>
        <p className="text-xs text-ink-2">
          {new Date(event.event_date).toLocaleString()} · {event.venue ?? '—'} · {event.status}
        </p>
      </div>

      <div className="grid grid-cols-4 gap-3 text-center text-xs">
        <div className="card p-4"><p className="text-ink-2">Yes</p><p className="text-lg font-semibold text-emerald-700">{replyCounts.yes}</p></div>
        <div className="card p-4"><p className="text-ink-2">No</p><p className="text-lg font-semibold text-red-700">{replyCounts.no}</p></div>
        <div className="card p-4"><p className="text-ink-2">Maybe</p><p className="text-lg font-semibold text-amber-700">{replyCounts.maybe}</p></div>
        <div className="card p-4"><p className="text-ink-2">Unclear</p><p className="text-lg font-semibold text-ink">{replyCounts.unclear}</p></div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link href={`/events/${eventId}/pick-contacts`} className="btn-primary">
          Add contacts &amp; generate drafts
        </Link>
        <Link href={`/events/${eventId}/queue`} className="btn">
          Review queue ({counts.drafted + counts.approved})
        </Link>
        <Link href={`/events/${eventId}/replies`} className="btn">
          Replies ({allReplies.length})
        </Link>
        <form action={check}>
          <button
            type="submit"
            disabled={checkInFlight}
            className="btn disabled:cursor-not-allowed disabled:opacity-60"
          >
            {checkInFlight ? 'Checking…' : 'Check replies now'}
          </button>
        </form>
        {checkInFlight && (
          <span className="self-center text-xs text-ink-2">
            Worker running, page will refresh automatically.
          </span>
        )}
      </div>

      {/* Two-column split on wide monitors: RSVP roster on the left, EDM
          context + starter drafts stacked on the right. Stacks vertically
          below the `lg` breakpoint (1024px viewport). */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <DelegateSheetField eventId={event.id} initialUrl={event.delegate_sheet_url ?? null} />
          <RsvpSummarySection data={rsvpSummary} />
        </div>
        <div className="space-y-6">
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
