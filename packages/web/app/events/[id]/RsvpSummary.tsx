import type { RsvpInvitee, RsvpSummary as RsvpSummaryData } from './actions';

function FollowUpBadge({ invitee }: { invitee: RsvpInvitee }) {
  if (invitee.follow_up_status) {
    return (
      <span className="badge badge-blue">
        Follow-up: {invitee.follow_up_status}
      </span>
    );
  }
  if (invitee.follow_up_eligible) {
    return (
      <span className="badge badge-amber">
        Follow-up suggested
      </span>
    );
  }
  return (
    <span className="badge badge-neutral">
      No follow-up yet
    </span>
  );
}

function ExpectedBadge({ invitee }: { invitee: RsvpInvitee }) {
  const map: Record<RsvpInvitee['expected_response'], { label: string; variant: string }> = {
    'likely-yes': {
      label: 'Likely to come back to us',
      variant: 'badge-green',
    },
    unsure: {
      label: 'May not respond without a nudge',
      variant: 'badge-amber',
    },
    unlikely: {
      label: 'Unlikely to respond again',
      variant: 'badge-neutral',
    },
  };
  const v = map[invitee.expected_response];
  return <span className={`badge ${v.variant}`}>{v.label}</span>;
}

function InviteeCard({ invitee }: { invitee: RsvpInvitee }) {
  return (
    <li className="card-quiet p-4 space-y-1.5 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <strong className="text-ink">{invitee.contact_name}</strong>
        <span className="text-xs text-ink-3">
          replied {invitee.days_since_reply !== null ? `${invitee.days_since_reply}d ago` : '—'} ·
          invited {invitee.days_since_sent}d ago
        </span>
      </div>
      {invitee.summary && (
        <p className="text-xs italic text-ink-2">{invitee.summary}</p>
      )}
      {invitee.reply_text && (
        <blockquote className="rounded-sm bg-surface p-2 text-xs text-ink-2 whitespace-pre-wrap">
          {invitee.reply_text}
        </blockquote>
      )}
      <div className="flex flex-wrap gap-1.5 pt-0.5">
        <ExpectedBadge invitee={invitee} />
        <FollowUpBadge invitee={invitee} />
      </div>
    </li>
  );
}

function NoReplyCard({ invitee }: { invitee: RsvpInvitee }) {
  return (
    <li className="card-quiet p-4 space-y-1 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <strong className="text-ink">{invitee.contact_name}</strong>
        <span className="text-xs text-ink-3">invited {invitee.days_since_sent}d ago</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <FollowUpBadge invitee={invitee} />
      </div>
    </li>
  );
}

export function RsvpSummarySection({ data }: { data: RsvpSummaryData }) {
  const total = data.yes.length + data.no.length + data.maybe.length + data.unclear.length + data.no_reply_yet.length;

  return (
    <section className="card p-5 space-y-6">
      <div className="flex items-baseline justify-between">
        <h3 className="text-base font-semibold text-ink">RSVP summary</h3>
        <span className="text-xs text-ink-3">{total} sent invitations</span>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1">
          <p className="eyebrow text-emerald-700">
            Yes ({data.yes.length})
          </p>
          {data.yes.length === 0 ? (
            <p className="text-xs text-ink-3">No yeses yet.</p>
          ) : (
            <p className="text-sm text-ink">
              {data.yes.map((y) => y.contact_name).join(', ')}
            </p>
          )}
        </div>

        <div className="space-y-1">
          <p className="eyebrow text-red-700">
            No ({data.no.length})
          </p>
          {data.no.length === 0 ? (
            <p className="text-xs text-ink-3">No declines.</p>
          ) : (
            <p className="text-sm text-ink">
              {data.no.map((n) => n.contact_name).join(', ')}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <p className="eyebrow text-amber-700">
          Maybe ({data.maybe.length})
        </p>
        {data.maybe.length === 0 ? (
          <p className="text-xs text-ink-3">No maybes.</p>
        ) : (
          <ul className="space-y-2">
            {data.maybe.map((i) => (
              <InviteeCard key={i.invite_id} invitee={i} />
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <p className="eyebrow text-ink-2">
          Unclear ({data.unclear.length})
        </p>
        {data.unclear.length === 0 ? (
          <p className="text-xs text-ink-3">Nothing unclear.</p>
        ) : (
          <ul className="space-y-2">
            {data.unclear.map((i) => (
              <InviteeCard key={i.invite_id} invitee={i} />
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <p className="eyebrow text-ink-3">
          No reply yet ({data.no_reply_yet.length})
        </p>
        {data.no_reply_yet.length === 0 ? (
          <p className="text-xs text-ink-3">Everyone has responded.</p>
        ) : (
          <ul className="grid gap-2 md:grid-cols-2">
            {data.no_reply_yet.map((i) => (
              <NoReplyCard key={i.invite_id} invitee={i} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
