// packages/web/lib/limbo-read.ts
import 'server-only';
import { getDb } from '@/lib/db';
import { getSetting } from '@event-drafter/core/settings';
import { invites, follow_ups, replies, contacts, events, jobs } from '@event-drafter/core/schema';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { STALE_MS } from './worker-state';
import { selectLimbo, type LimboList, type LimboRecord, type LimboType } from './limbo';

const NAME = sql<string>`${contacts.first_name} || ' ' || COALESCE(${contacts.last_name}, '')`;
const MID = ['sending', 'prefilled'] as const;

function inviteCandidates(): LimboRecord[] {
  return getDb()
    .select({ id: invites.id, status: invites.status, name: NAME, eventId: events.id, eventName: events.name })
    .from(invites)
    .innerJoin(contacts, eq(invites.contact_id, contacts.id))
    .innerJoin(events, eq(invites.event_id, events.id))
    .where(inArray(invites.status, [...MID]))
    .all()
    .map((r) => ({ type: 'invite' as LimboType, id: r.id, state: r.status as 'sending' | 'prefilled', name: r.name, eventId: r.eventId, eventName: r.eventName }));
}

function followUpCandidates(): LimboRecord[] {
  return getDb()
    .select({ id: follow_ups.id, status: follow_ups.status, name: NAME, eventId: events.id, eventName: events.name })
    .from(follow_ups)
    .innerJoin(invites, eq(follow_ups.invite_id, invites.id))
    .innerJoin(contacts, eq(invites.contact_id, contacts.id))
    .innerJoin(events, eq(invites.event_id, events.id))
    .where(inArray(follow_ups.status, [...MID]))
    .all()
    .map((r) => ({ type: 'follow_up' as LimboType, id: r.id, state: r.status as 'sending' | 'prefilled', name: r.name, eventId: r.eventId, eventName: r.eventName }));
}

function replyCandidates(): LimboRecord[] {
  return getDb()
    .select({ id: replies.id, status: replies.response_status, name: NAME, eventId: events.id, eventName: events.name })
    .from(replies)
    .innerJoin(invites, eq(replies.invite_id, invites.id))
    .innerJoin(contacts, eq(invites.contact_id, contacts.id))
    .innerJoin(events, eq(invites.event_id, events.id))
    .where(inArray(replies.response_status, [...MID]))
    .all()
    .map((r) => ({ type: 'reply' as LimboType, id: r.id, state: r.status as 'sending' | 'prefilled', name: r.name, eventId: r.eventId, eventName: r.eventName }));
}

/** The record the running send job targets, mapped to {type,id}. Null if none.
 *  Only considers jobs claimed by the CURRENT worker session (started_at >= sessionStart),
 *  so orphaned jobs from a crashed previous session are not excluded from limbo. */
function runningSendTarget(sessionStart: number): { type: LimboType; id: number } | null {
  const job = getDb()
    .select({ kind: jobs.kind, payload: jobs.payload })
    .from(jobs)
    .where(
      and(
        eq(jobs.status, 'running'),
        inArray(jobs.kind, ['send_message', 'send_follow_up', 'send_response']),
        gte(jobs.started_at, new Date(sessionStart)),
      ),
    )
    .limit(1)
    .get();
  if (!job) return null;
  const p = (job.payload ?? {}) as Record<string, number>;
  if (job.kind === 'send_message' && p.invite_id) return { type: 'invite', id: p.invite_id };
  if (job.kind === 'send_follow_up' && p.follow_up_id) return { type: 'follow_up', id: p.follow_up_id };
  if (job.kind === 'send_response' && p.reply_id) return { type: 'reply', id: p.reply_id };
  return null;
}

export function readLimbo(now: number = Date.now()): LimboList {
  const autoSend = getSetting('auto_send_enabled') === true;
  const hb = getSetting('worker_heartbeat');
  const connected = !!hb && now - hb.ts < STALE_MS;
  const activeSend = connected && hb?.startedAt != null ? runningSendTarget(hb.startedAt) : null;
  const records = [...inviteCandidates(), ...followUpCandidates(), ...replyCandidates()];
  return selectLimbo({ records, autoSend, activeSend });
}
