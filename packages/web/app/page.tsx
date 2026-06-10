import Link from 'next/link';
import { getDb } from '@/lib/db';
import { jobs, events, contacts, replies } from '@vip/core/schema';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const db = getDb();
  const jobStatusRows = db
    .select({ status: jobs.status, count: sql<number>`count(*)` })
    .from(jobs)
    .groupBy(jobs.status)
    .all();
  const jobBy: Record<string, number> = { queued: 0, running: 0, succeeded: 0, failed: 0 };
  for (const r of jobStatusRows) jobBy[r.status] = Number(r.count);
  const jobActive = jobBy.queued + jobBy.running;
  const contactCount = db.select({ count: sql<number>`count(*)` }).from(contacts).all()[0]?.count ?? 0;
  const eventCount = db.select({ count: sql<number>`count(*)` }).from(events).all()[0]?.count ?? 0;
  const replyCount = db.select({ count: sql<number>`count(*)` }).from(replies).all()[0]?.count ?? 0;
  return (
    <section className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        <Link href="/contacts" className="rounded border border-neutral-200 bg-white p-3 hover:bg-neutral-50">
          <p className="text-xs text-neutral-500">Contacts</p>
          <p className="text-2xl font-semibold">{contactCount}</p>
        </Link>
        <Link href="/events" className="rounded border border-neutral-200 bg-white p-3 hover:bg-neutral-50">
          <p className="text-xs text-neutral-500">Events</p>
          <p className="text-2xl font-semibold">{eventCount}</p>
        </Link>
        <Link href="/replies" className="rounded border border-neutral-200 bg-white p-3 hover:bg-neutral-50">
          <p className="text-xs text-neutral-500">Replies</p>
          <p className="text-2xl font-semibold">{replyCount}</p>
        </Link>
        <Link href="/status" className="rounded border border-neutral-200 bg-white p-3 hover:bg-neutral-50">
          <p className="text-xs text-neutral-500">Jobs (active / failed)</p>
          <p className="text-2xl font-semibold">
            {jobActive}
            <span className={`ml-2 text-base ${jobBy.failed > 0 ? 'text-red-700' : 'text-neutral-400'}`}>
              / {jobBy.failed}
            </span>
          </p>
        </Link>
      </div>
      <p className="text-sm text-neutral-600">
        First time? <Link href="/setup" className="underline">Run setup</Link>.
      </p>
    </section>
  );
}
