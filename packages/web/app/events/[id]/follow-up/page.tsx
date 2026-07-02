import { notFound } from 'next/navigation';
import { getDb } from '@event-drafter/core/db';
import { events } from '@event-drafter/core/schema';
import { eq } from 'drizzle-orm';
import { listInvitesForFollowUp, listTemplates } from './actions';
import { FollowUpComposer } from './FollowUpComposer';

export const dynamic = 'force-dynamic';

export default async function FollowUpPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const eventId = Number(id);
  if (!Number.isFinite(eventId)) notFound();

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
      />
    </section>
  );
}
