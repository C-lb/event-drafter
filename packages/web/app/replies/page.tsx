import Link from 'next/link';
import {
  listAllReplies,
  listAwaitingInvites,
  latestReplyCheck,
  maybeEnqueueAutoReplyCheck,
  triggerReplyCheck,
  resolvedReplyCount,
} from './actions';
import { ReplyCard, type ReplyRow } from './ReplyCard';
import { AutoRefresh } from '../components/AutoRefresh';

export const dynamic = 'force-dynamic';

function ago(ts: Date | number | null | undefined): string {
  if (!ts) return '—';
  const ms = Date.now() - (ts instanceof Date ? ts.getTime() : Number(ts));
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

const FILTERS = ['all', 'yes', 'no', 'maybe', 'unclear', 'awaiting'] as const;
type Filter = (typeof FILTERS)[number];

const FILTER_LABEL: Record<Filter, string> = {
  all: 'All',
  yes: 'Yes',
  no: 'No',
  maybe: 'Maybe',
  unclear: 'Unclear',
  awaiting: 'No reply yet',
};

interface PageProps {
  searchParams: Promise<{ resolved?: string; filter?: string }>;
}

export default async function AllRepliesPage({ searchParams }: PageProps) {
  const { resolved: resolvedParam, filter: filterParam } = await searchParams;
  const includeResolved = resolvedParam === '1';
  const filter: Filter = (FILTERS as readonly string[]).includes(filterParam ?? '')
    ? (filterParam as Filter)
    : 'all';

  // Kick a check_replies job ourselves if the last one finished over 30 min
  // ago, so a yes/no contact who later sent a follow-up question lands in
  // the dashboard without the operator having to click "Check now".
  await maybeEnqueueAutoReplyCheck();

  const [all, awaiting, last, resolvedCount] = await Promise.all([
    listAllReplies({ includeResolved }),
    listAwaitingInvites(),
    latestReplyCheck(),
    resolvedReplyCount(),
  ]);
  const inFlight = last?.status === 'queued' || last?.status === 'running';

  const counts: Record<Filter, number> = {
    all: all.length,
    yes: all.filter((r) => r.classification === 'yes').length,
    no: all.filter((r) => r.classification === 'no').length,
    maybe: all.filter((r) => r.classification === 'maybe').length,
    unclear: all.filter((r) => r.classification === 'unclear').length,
    awaiting: awaiting.length,
  };

  const visibleReplies =
    filter === 'all' || filter === 'awaiting'
      ? all
      : all.filter((r) => r.classification === filter);

  // Build a /replies href preserving filter + resolved state.
  const buildHref = (f: Filter, resolved: boolean) => {
    const p = new URLSearchParams();
    if (f !== 'all') p.set('filter', f);
    if (resolved) p.set('resolved', '1');
    const qs = p.toString();
    return qs ? `/replies?${qs}` : '/replies';
  };

  const chipCls = (f: Filter) =>
    `rounded px-2.5 py-1 text-xs font-medium transition-colors ${
      filter === f
        ? 'bg-blue-600 text-white'
        : 'bg-neutral-200 text-neutral-700 hover:bg-neutral-300'
    }`;

  return (
    <section className="max-w-7xl space-y-3">
      <AutoRefresh active={inFlight} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-3xl font-semibold tracking-tight">
          {includeResolved ? 'All replies (incl. resolved)' : 'All replies'}
        </h2>
        <div className="flex items-center gap-2">
          {resolvedCount > 0 && (
            <Link
              href={buildHref(filter, !includeResolved)}
              className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50"
            >
              {includeResolved ? `Hide resolved (${resolvedCount})` : `Show resolved (${resolvedCount})`}
            </Link>
          )}
          <form action={triggerReplyCheck}>
            <button
              type="submit"
              disabled={inFlight}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {inFlight ? 'Checking…' : 'Check now'}
            </button>
          </form>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link key={f} href={buildHref(f, includeResolved)} className={chipCls(f)}>
            {FILTER_LABEL[f]} ({counts[f]})
          </Link>
        ))}
      </div>

      {last ? (
        <p className="text-xs text-neutral-600">
          Last check: <strong>{last.status}</strong> · started {ago(last.created_at)}
          {last.finished_at ? ` · finished ${ago(last.finished_at)}` : ''}
          {last.last_error ? ` · error: ${last.last_error.slice(0, 120)}` : ''}
        </p>
      ) : (
        <p className="text-xs text-neutral-600">No checks have run yet.</p>
      )}

      {filter === 'awaiting' ? (
        awaiting.length === 0 ? (
          <p className="rounded border border-dashed border-neutral-300 bg-neutral-50 p-4 text-sm text-neutral-600">
            Everyone who was sent an invite has replied.
          </p>
        ) : (
          <ul className="space-y-2">
            {awaiting.map((a) => (
              <li
                key={a.invite_id}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-neutral-200 bg-white p-3 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md border border-neutral-300 bg-neutral-100 px-2 py-1 text-xs font-semibold tracking-wide text-neutral-500">
                    — NO REPLY
                  </span>
                  <strong>{a.contact_name}</strong>
                  <Link
                    href={`/events/${a.event_id}/replies`}
                    className="text-xs text-blue-700 underline"
                  >
                    {a.event_name}
                  </Link>
                </div>
                <span className="text-xs text-neutral-500">invited {ago(a.sent_at)}</span>
              </li>
            ))}
          </ul>
        )
      ) : visibleReplies.length === 0 ? (
        <p className="rounded border border-dashed border-neutral-300 bg-neutral-50 p-4 text-sm text-neutral-600">
          {filter === 'all'
            ? includeResolved
              ? 'No replies yet.'
              : 'No active replies. Anything resolved is hidden — toggle the button above to show them.'
            : `No ${FILTER_LABEL[filter].toLowerCase()} replies in this view.`}
        </p>
      ) : (
        <ul className="space-y-2">
          {visibleReplies.map((r) => (
            <ReplyCard key={r.reply_id} r={r as ReplyRow} />
          ))}
        </ul>
      )}
    </section>
  );
}
