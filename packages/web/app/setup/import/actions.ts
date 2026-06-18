'use server';

import { getDb } from '@event-drafter/core/db';
import { jobs, contacts } from '@event-drafter/core/schema';
import { sql } from 'drizzle-orm';
import { markSetupCompleted } from '../actions';

export async function enqueueImport() {
  const db = getDb();
  db.insert(jobs).values({ kind: 'import_contacts', payload: {} }).run();
}

export async function importStatus() {
  const db = getDb();
  const recent = db
    .select()
    .from(jobs)
    .where(sql`kind = 'import_contacts'`)
    .orderBy(sql`created_at DESC`)
    .limit(1)
    .all();
  const contactCount = db.select({ count: sql<number>`count(*)` }).from(contacts).all()[0]?.count ?? 0;
  return { job: recent[0] ?? null, contactCount };
}

export async function completeSetup() {
  await markSetupCompleted();
}
