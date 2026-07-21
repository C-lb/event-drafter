import Link from 'next/link';
import { getDb } from '@/lib/db';
import { events } from '@event-drafter/core/schema';
import { eq } from 'drizzle-orm';
import {
  listAllReplies,
  latestReplyCheck,
  maybeEnqueueAutoReplyCheck,
} from '../../../replies/actions';
import { type ReplyRow } from '../../../replies/ReplyCard';
import { RepliesQueue } from '../../../replies/RepliesQueue';
import { AutoRefresh } from '../../../components/AutoRefresh';
import { CheckNowButton } from '../../../replies/CheckNowButton';

export const dynamic = 'force-dynamic';

function ago(ts: Date | number | null | undefined): string {
  if (!ts) return '—';
  const ms = Date.now() - (ts instanceof Date ? ts.getTime() : Number(ts));
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

const FILTERS = ['all', 'yes', 'no', 'maybe', 'unclear'] as const;
type Filter = (typeof FILTERS)[number];

const FILTER_LABEL: Record<Filter, string> = {
  all: 'All',
  yes: 'Yes',
  no: 'No',
  maybe: 'Maybe',
  unclear: 'Unclear',
};

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ resolved?: string; filter?: string }>;
}

export default async function EventRepliesPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const eventId = Number(id);
  const { resolved: resolvedParam, filter: filterParam } = await searchParams;
  const includeResolved = resolvedParam === '1';
  const filter: Filter = (FILTERS as readonly string[]).includes(filterParam ?? '')
    ? (filterParam as Filter)
    : 'all';

  await maybeEnqueueAutoReplyCheck();

  const [allReplies, last] = await Promise.all([listAllReplies({ includeResolved }), latestReplyCheck()]);
  const eventName = getDb().select({ name: events.name }).from(events).where(eq(events.id, eventId)).all()[0]?.name;

  // Only this event's replies.
  const scoped = allReplies.filter((r) => r.event_id === eventId);

  const inFlight = last?.status === 'queued' || last?.status === 'running';
  const reactionInFlight = scoped.some(
    (r) => r.reaction_status === 'pending' || r.reaction_status === 'sending',
  );
  const responseInFlight = scoped.some(
    (r) =>
      r.response_status === 'sending' ||
      r.response_status === 'approved' ||
      r.response_status === 'prefilled',
  );
  const pollActive = inFlight || reactionInFlight || responseInFlight;

  const counts: Record<Filter, number> = {
    all: scoped.length,
    yes: scoped.filter((r) => r.classification === 'yes').length,
    no: scoped.filter((r) => r.classification === 'no').length,
    maybe: scoped.filter((r) => r.classification === 'maybe').length,
    unclear: scoped.filter((r) => r.classification === 'unclear').length,
  };

  const visibleReplies = filter === 'all' ? scoped : scoped.filter((r) => r.classification === filter);

  const buildHref = (f: Filter, resolved: boolean) => {
    const p = new URLSearchParams();
    if (f !== 'all') p.set('filter', f);
    if (resolved) p.set('resolved', '1');
    const qs = p.toString();
    return qs ? `/events/${eventId}/replies?${qs}` : `/events/${eventId}/replies`;
  };

  const chipCls = (f: Filter) =>
    `rounded-full px-3 py-1 text-xs font-medium transition ${
      filter === f
        ? 'bg-ink text-white shadow-raise'
        : 'bg-line text-ink-2 hover:bg-line-strong hover:text-ink'
    }`;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-2xl font-semibold tracking-tight">Replies</h2>
          {eventName && <p className="mt-0.5 truncate text-sm text-ink-3">{eventName}</p>}
        </div>
        <CheckNowButton inFlight={inFlight} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Link key={f} href={buildHref(f, includeResolved)} className={chipCls(f)}>
              {FILTER_LABEL[f]} ({counts[f]})
            </Link>
          ))}
        </div>
        <Link href={buildHref(filter, !includeResolved)} className="btn btn-sm">
          {includeResolved ? 'Hide past replies' : 'Show past replies'}
        </Link>
      </div>

      {last ? (
        <p className="text-xs text-ink-3">
          Last check: <strong className="text-ink-2">{last.status}</strong> · started {ago(last.created_at)}
          {last.finished_at ? ` · finished ${ago(last.finished_at)}` : ''}
          {last.last_error ? ` · error: ${last.last_error.slice(0, 120)}` : ''}
        </p>
      ) : (
        <p className="text-xs text-ink-3">No checks have run yet.</p>
      )}

      {visibleReplies.length === 0 ? (
        <p className="card-quiet p-5 text-sm text-ink-2">
          {filter === 'all'
            ? includeResolved
              ? 'No replies yet for this event.'
              : 'No active replies. Past replies are hidden. Toggle the button above to show them.'
            : `No ${FILTER_LABEL[filter].toLowerCase()} replies in this view.`}
        </p>
      ) : (
        <RepliesQueue replies={visibleReplies as ReplyRow[]} active={pollActive} />
      )}
    </section>
  );
}
