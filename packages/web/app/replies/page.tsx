import Link from 'next/link';
import {
  listAllReplies,
  listAwaitingInvites,
  latestReplyCheck,
  maybeEnqueueAutoReplyCheck,
  resolvedReplyCount,
} from './actions';
import { type ReplyRow } from './ReplyCard';
import { RepliesQueue } from './RepliesQueue';
import { AutoRefresh } from '../components/AutoRefresh';
import { CheckNowButton } from './CheckNowButton';

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
  // A reaction is dispatched as an async worker job; its row's reaction_status
  // moves pending/sending -> sent/failed only once the worker finishes. Poll
  // while any reaction is mid-flight so the card reflects the outcome without a
  // manual reload (otherwise "Reacting…" sticks until Cmd+R).
  const reactionInFlight = all.some(
    (r) => r.reaction_status === 'pending' || r.reaction_status === 'sending',
  );
  // Auto-draft-and-send moves a row through sending -> approved -> prefilled in
  // the worker; poll until it settles so the card reflects the result.
  const responseInFlight = all.some(
    (r) =>
      r.response_status === 'sending' ||
      r.response_status === 'approved' ||
      r.response_status === 'prefilled',
  );
  const pollActive = inFlight || reactionInFlight || responseInFlight;

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
    `rounded-full px-3 py-1 text-xs font-medium transition ${
      filter === f
        ? 'bg-ink text-white shadow-raise'
        : 'bg-line text-ink-2 hover:bg-line-strong hover:text-ink'
    }`;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold tracking-tight">
          {includeResolved ? 'All replies (incl. past)' : 'All replies'}
        </h2>
        <div className="flex items-center gap-2">
          {resolvedCount > 0 && (
            <Link href={buildHref(filter, !includeResolved)} className="btn btn-sm">
              {includeResolved ? 'Hide past replies' : 'Show past replies'}
            </Link>
          )}
          <CheckNowButton inFlight={inFlight} />
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
        <p className="text-xs text-ink-3">
          Last check: <strong className="text-ink-2">{last.status}</strong> · started {ago(last.created_at)}
          {last.finished_at ? ` · finished ${ago(last.finished_at)}` : ''}
          {last.last_error ? ` · error: ${last.last_error.slice(0, 120)}` : ''}
        </p>
      ) : (
        <p className="text-xs text-ink-3">No checks have run yet.</p>
      )}

      {filter === 'awaiting' ? (
        <>
        <AutoRefresh active={pollActive} />
        {awaiting.length === 0 ? (
          <p className="card-quiet p-5 text-sm text-ink-2">
            Everyone who was sent an invite has replied.
          </p>
        ) : (
          <ul className="space-y-3">
            {awaiting.map((a) => (
              <li
                key={a.invite_id}
                className="card flex flex-wrap items-center justify-between gap-2 p-4 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="badge badge-neutral">No reply yet</span>
                  <strong>{a.contact_name}</strong>
                  <Link
                    href={`/events/${a.event_id}/replies`}
                    className="text-xs font-medium text-accent hover:text-accent-hover"
                  >
                    {a.event_name}
                  </Link>
                </div>
                <span className="text-xs text-ink-3">invited {ago(a.sent_at)}</span>
              </li>
            ))}
          </ul>
        )}
        </>
      ) : visibleReplies.length === 0 ? (
        <p className="card-quiet p-5 text-sm text-ink-2">
          {filter === 'all'
            ? includeResolved
              ? 'No replies yet.'
              : 'No active replies. Past replies are hidden — toggle the button above to show them.'
            : `No ${FILTER_LABEL[filter].toLowerCase()} replies in this view.`}
        </p>
      ) : (
        <RepliesQueue replies={visibleReplies as ReplyRow[]} active={pollActive} />
      )}
    </section>
  );
}
