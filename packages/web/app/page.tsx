import { getDb } from '@/lib/db';
import { jobs } from '@vip/core/schema';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const db = getDb();
  const [{ count }] = db
    .select({ count: sql<number>`count(*)` })
    .from(jobs)
    .all();
  return (
    <section>
      <p className="text-sm text-neutral-600">
        Foundation scaffold. <code>jobs</code> table row count: {count ?? 0}.
      </p>
    </section>
  );
}
