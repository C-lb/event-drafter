import Link from 'next/link';
import { getDb } from '@/lib/db';
import { jobs, events, contacts, replies } from '@vip/core/schema';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const db = getDb();
  const jobCount = db.select({ count: sql<number>`count(*)` }).from(jobs).all()[0]?.count ?? 0;
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
        <div className="rounded border border-neutral-200 bg-white p-3">
          <p className="text-xs text-neutral-500">Jobs total</p>
          <p className="text-2xl font-semibold">{jobCount}</p>
        </div>
      </div>
      <p className="text-sm text-neutral-600">
        First time? <Link href="/setup" className="underline">Run setup</Link>.
      </p>
    </section>
  );
}
