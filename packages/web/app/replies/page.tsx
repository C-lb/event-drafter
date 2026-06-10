import Link from 'next/link';
import { listAllReplies, latestReplyCheck, triggerReplyCheck } from './actions';

export const dynamic = 'force-dynamic';

function ago(ts: Date | number | null | undefined): string {
  if (!ts) return '—';
  const ms = Date.now() - (ts instanceof Date ? ts.getTime() : Number(ts));
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

export default async function AllRepliesPage() {
  const [all, last] = await Promise.all([listAllReplies(), latestReplyCheck()]);
  const inFlight = last?.status === 'queued' || last?.status === 'running';

  return (
    <section className="max-w-3xl space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">All replies</h2>
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

      {last ? (
        <p className="text-xs text-neutral-600">
          Last check: <strong>{last.status}</strong> · started {ago(last.created_at)}
          {last.finished_at ? ` · finished ${ago(last.finished_at)}` : ''}
          {last.last_error ? ` · error: ${last.last_error.slice(0, 120)}` : ''}
        </p>
      ) : (
        <p className="text-xs text-neutral-600">No checks have run yet.</p>
      )}

      <ul className="space-y-2">
        {all.map((r) => (
          <li key={r.reply_id} className="rounded border border-neutral-200 bg-white p-3 text-sm">
            <p>
              <strong>{r.contact_name}</strong> ·{' '}
              <Link href={`/events/${r.event_id}/replies`} className="text-blue-700 underline">
                {r.event_name}
              </Link>{' '}
              · <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs">{r.classification ?? 'unclassified'}</span>
            </p>
            {r.summary && <p className="text-xs italic text-neutral-600">{r.summary}</p>}
            <p className="mt-1 line-clamp-2 text-neutral-700">{r.reply_text}</p>
            <p className="mt-1 text-xs text-neutral-500">
              {r.detected_at ? new Date(r.detected_at as unknown as Date).toLocaleString() : ''} · response: {r.response_status ?? 'pending'}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
