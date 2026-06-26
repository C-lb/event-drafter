import type { Job } from '@event-drafter/core';
import { getDb } from '@event-drafter/core/db';
import { contacts } from '@event-drafter/core/schema';
import { getSetting } from '@event-drafter/core/settings';
import { fetchAllRows } from '../google/sheets.js';
import { logger } from '../logger.js';
import { eq, sql } from 'drizzle-orm';

export async function importContactsHandler(_job: Job): Promise<void> {
  const cfg = getSetting('contacts_sheet');
  if (!cfg) throw new Error('contacts_sheet setting not configured');

  const rows = await fetchAllRows(cfg);
  logger.info('import_contacts: fetched rows', { count: rows.length });

  const db = getDb();
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  db.transaction((tx) => {
    for (const row of rows) {
      const existing = tx.select().from(contacts).where(eq(contacts.phone_e164, row.phone_e164)).get();
      if (!existing) {
        tx.insert(contacts).values(row).run();
        inserted++;
      } else if (existing.sheet_row_hash !== row.sheet_row_hash) {
        tx.update(contacts)
          .set({
            first_name: row.first_name,
            last_name: row.last_name,
            email: row.email,
            secondary_phone_e164: row.secondary_phone_e164,
            remarks: row.remarks,
            sheet_row_hash: row.sheet_row_hash,
            sheet_row_index: row.sheet_row_index,
            updated_at: sql`(unixepoch() * 1000)`,
          })
          .where(eq(contacts.id, existing.id))
          .run();
        updated++;
      } else if (existing.sheet_row_index !== row.sheet_row_index) {
        // Content identical but the contact moved rows in the sheet — keep the
        // serial/order in sync without bumping updated_at.
        tx.update(contacts)
          .set({ sheet_row_index: row.sheet_row_index })
          .where(eq(contacts.id, existing.id))
          .run();
        updated++;
      } else {
        skipped++;
      }
    }
  });

  logger.info('import_contacts: done', { inserted, updated, skipped });
}
