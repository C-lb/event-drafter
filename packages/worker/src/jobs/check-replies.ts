import type { Job } from '@vip/core';
import { getDb } from '@vip/core/db';
import { invites, replies, jobs, contacts } from '@vip/core/schema';
import { and, eq, gt, isNotNull } from 'drizzle-orm';
import { readChatInbound } from '../wa/driver.js';
import { WaInvalidNumber, WaNotLoggedIn, WaSelectorMismatch } from '../wa/session.js';
import { JobDeferred } from '../errors.js';
import { logger } from '../logger.js';

const LOOKBACK_DAYS = 14;
const READ_GAP_MS = 2000;

export async function checkRepliesHandler(_job: Job): Promise<void> {
  const db = getDb();
  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 3600 * 1000);

  const rows = db
    .select({
      invite_id: invites.id,
      phone: contacts.phone_e164,
      contact_name: contacts.first_name,
      sent_at: invites.sent_at,
    })
    .from(invites)
    .innerJoin(contacts, eq(invites.contact_id, contacts.id))
    .where(and(eq(invites.status, 'sent'), gt(invites.sent_at, cutoff), isNotNull(invites.sent_at)))
    .all();

  logger.info('check_replies: starting', { invite_count: rows.length });

  let totalNew = 0;
  for (const row of rows) {
    try {
      const inbound = await readChatInbound(row.phone);
      const sentAt = row.sent_at as Date;
      const candidates = inbound.filter((m) => m.wa_sent_at.getTime() >= sentAt.getTime());

      if (candidates.length === 0) {
        await sleep(READ_GAP_MS);
        continue;
      }

      const newIds = db.transaction((tx) => {
        const ids: number[] = [];
        for (const m of candidates) {
          if (m.wa_message_id) {
            const exists = tx
              .select({ id: replies.id })
              .from(replies)
              .where(and(eq(replies.invite_id, row.invite_id), eq(replies.wa_message_id, m.wa_message_id)))
              .get();
            if (exists) continue;
          }
          const inserted = tx.insert(replies).values({
            invite_id: row.invite_id,
            wa_message_id: m.wa_message_id ?? null,
            wa_message_text: m.text,
            wa_sent_at: m.wa_sent_at,
            response_status: 'pending',
          }).returning().get();
          ids.push(inserted.id);
          tx.insert(jobs).values({
            kind: 'classify_reply',
            payload: { reply_id: inserted.id },
          }).run();
        }
        return ids;
      });

      totalNew += newIds.length;
      if (newIds.length > 0) {
        logger.info('check_replies: new replies', { invite_id: row.invite_id, count: newIds.length });
      }
    } catch (err) {
      if (err instanceof WaNotLoggedIn) {
        throw new JobDeferred(10 * 60 * 1000, 'WA not logged in — defer 10 min');
      }
      if (err instanceof WaSelectorMismatch) {
        throw new JobDeferred(60 * 60 * 1000, `selector mismatch — defer 1h: ${err.message}`);
      }
      if (err instanceof WaInvalidNumber) {
        logger.warn('check_replies: invalid number', { invite_id: row.invite_id });
        continue;
      }
      logger.error('check_replies: chat error', {
        invite_id: row.invite_id,
        err: err instanceof Error ? err.message : String(err),
      });
    }
    await sleep(READ_GAP_MS);
  }

  logger.info('check_replies: done', { totalNew });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
