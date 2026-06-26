import type { Job } from '@event-drafter/core';
import { getDb } from '@event-drafter/core/db';
import { contacts, events, invites, replies } from '@event-drafter/core/schema';
import { and, eq, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { parseSheetUrl, phoneKey, shiftConfirmedToTop } from '../google/sheets.js';
import { logger } from '../logger.js';

const payloadSchema = z.object({ event_id: z.number() });

/**
 * Rebuild the confirmed/pending ordering of an event's delegate tracker sheet.
 * Self-healing: each run recomputes the full set of yes-confirmed delegates
 * from the DB and reorders the sheet, so repeated runs converge and a missed
 * trigger is corrected by the next one.
 */
export async function updateDelegateTrackerHandler(job: Job): Promise<void> {
  const { event_id } = payloadSchema.parse(job.payload);
  const db = getDb();

  const event = db.select().from(events).where(eq(events.id, event_id)).get();
  if (!event) throw new Error(`event ${event_id} not found`);
  if (!event.delegate_sheet_url) {
    logger.info('update_delegate_tracker: no tracker sheet set, skipping', { event_id });
    return;
  }

  // Yes-confirmed delegates: a 'yes' classification whose response the operator
  // has approved. Match the tracker by phone (last 8 digits).
  const rows = db
    .select({ phone: contacts.phone_e164 })
    .from(invites)
    .innerJoin(contacts, eq(invites.contact_id, contacts.id))
    .innerJoin(replies, eq(replies.invite_id, invites.id))
    .where(
      and(
        eq(invites.event_id, event_id),
        eq(replies.classification, 'yes'),
        isNotNull(replies.response_approved_at),
      ),
    )
    .all();

  const confirmedKeys = new Set(rows.map((r) => phoneKey(r.phone)).filter((k) => k.length > 0));
  const { spreadsheet_id } = parseSheetUrl(event.delegate_sheet_url);

  const result = await shiftConfirmedToTop(spreadsheet_id, confirmedKeys);
  logger.info('update_delegate_tracker: done', {
    event_id,
    confirmed: result.confirmed,
    changed: result.changed,
  });
}
