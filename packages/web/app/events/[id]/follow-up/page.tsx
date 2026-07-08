import { notFound } from 'next/navigation';
import { getDb } from '@event-drafter/core/db';
import { events } from '@event-drafter/core/schema';
import { eq } from 'drizzle-orm';
import { listInvitesForFollowUp, listTemplates } from './actions';
import { FollowUpComposer } from './FollowUpComposer';

export const dynamic = 'force-dynamic';

export default async function FollowUpPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ invite?: string }>;
}) {
  const { id } = await params;
  const { invite } = await searchParams;
  const eventId = Number(id);
  if (!Number.isFinite(eventId)) notFound();

  // Optional deep-link from a reply card: preselect this one invitee so the
  // operator lands ready to follow up privately with them.
  const preselectInviteId = invite && Number.isFinite(Number(invite)) ? Number(invite) : undefined;

  const event = getDb().select().from(events).where(eq(events.id, eventId)).get();
  if (!event) notFound();

  const [invitees, templates] = await Promise.all([
    listInvitesForFollowUp(eventId),
    listTemplates(),
  ]);

  return (
    <section className="space-y-2">
      <p className="eyebrow">Follow up</p>
      <h2 className="text-2xl font-semibold tracking-tight">{event.name}</h2>
      <p className="text-sm text-ink-2">
        Pick who to follow up with, set their logistics, then draft the messages.
      </p>
      <FollowUpComposer
        eventId={eventId}
        invitees={invitees}
        templates={templates}
        preselectInviteId={preselectInviteId}
      />
    </section>
  );
}
