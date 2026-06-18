'use server';

import { getDb } from '@event-drafter/core/db';
import { jobs } from '@event-drafter/core/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

export async function triggerCleanup(): Promise<void> {
  const db = getDb();
  const existing = db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.kind, 'cleanup_jobs'), inArray(jobs.status, ['queued', 'running'])))
    .get();
  if (!existing) {
    db.insert(jobs).values({ kind: 'cleanup_jobs', payload: {}, status: 'queued' }).run();
  }
  revalidatePath('/status');
}
