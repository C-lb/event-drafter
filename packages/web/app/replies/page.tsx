import Link from 'next/link';
import {
  listAllReplies,
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

interface PageProps {
  searchParams: Promise<{ resolved?: string }>;
}

export default async function AllRepliesPage({ searchParams }: PageProps) {
  const { resolved: resolvedParam } = await searchParams;
  const includeResolved = resolvedParam === '1';

  // Kick a check_replies job ourselves if the last one finished over 30 min
  // ago, so a yes/no contact who later sent a follow-up question lands in
  // the dashboard without the operator having to click "Check now".
  await maybeEnqueueAutoReplyCheck();

  const [all, last, resolvedCount] = await Promise.all([
    listAllReplies({ includeResolved }),
    latestReplyCheck(),
    resolvedReplyCount(),
  ]);
  const inFlight = last?.status === 'queued' || last?.status === 'running';

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
              href={includeResolved ? '/replies' : '/replies?resolved=1'}
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

      {last ? (
        <p className="text-xs text-neutral-600">
          Last check: <strong>{last.status}</strong> · started {ago(last.created_at)}
          {last.finished_at ? ` · finished ${ago(last.finished_at)}` : ''}
          {last.last_error ? ` · error: ${last.last_error.slice(0, 120)}` : ''}
        </p>
      ) : (
        <p className="text-xs text-neutral-600">No checks have run yet.</p>
      )}

      {all.length === 0 ? (
        <p className="rounded border border-dashed border-neutral-300 bg-neutral-50 p-4 text-sm text-neutral-600">
          {includeResolved
            ? 'No replies yet.'
            : 'No active replies. Anything resolved is hidden — toggle the button above to show them.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {all.map((r) => (
            <ReplyCard key={r.reply_id} r={r as ReplyRow} />
          ))}
        </ul>
      )}
    </section>
  );
}
