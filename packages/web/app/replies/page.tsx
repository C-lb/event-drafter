import Link from 'next/link';
import { listAllReplies } from './actions';

export const dynamic = 'force-dynamic';

export default async function AllRepliesPage() {
  const all = await listAllReplies();
  return (
    <section className="max-w-3xl space-y-3">
      <h2 className="text-xl font-semibold">All replies</h2>
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
