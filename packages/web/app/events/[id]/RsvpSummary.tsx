import type { RsvpInvitee, RsvpSummary as RsvpSummaryData } from './actions';

function FollowUpBadge({ invitee }: { invitee: RsvpInvitee }) {
  if (invitee.follow_up_status) {
    return (
      <span className="rounded bg-blue-100 px-2 py-0.5 text-[11px] text-blue-800">
        follow-up: {invitee.follow_up_status}
      </span>
    );
  }
  if (invitee.follow_up_eligible) {
    return (
      <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800">
        follow-up suggested
      </span>
    );
  }
  return (
    <span className="rounded bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-600">
      no follow-up yet
    </span>
  );
}

function ExpectedBadge({ invitee }: { invitee: RsvpInvitee }) {
  const map: Record<RsvpInvitee['expected_response'], { label: string; cls: string }> = {
    'likely-yes': {
      label: 'Likely to come back to us',
      cls: 'bg-green-100 text-green-800',
    },
    unsure: {
      label: 'May not respond without a nudge',
      cls: 'bg-amber-100 text-amber-800',
    },
    unlikely: {
      label: 'Unlikely to respond again',
      cls: 'bg-neutral-200 text-neutral-700',
    },
  };
  const v = map[invitee.expected_response];
  return <span className={`rounded px-2 py-0.5 text-[11px] ${v.cls}`}>{v.label}</span>;
}

function InviteeCard({ invitee }: { invitee: RsvpInvitee }) {
  return (
    <li className="rounded border border-neutral-200 bg-white p-3 space-y-1.5 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <strong>{invitee.contact_name}</strong>
        <span className="text-xs text-neutral-500">
          replied {invitee.days_since_reply !== null ? `${invitee.days_since_reply}d ago` : '—'} ·
          invited {invitee.days_since_sent}d ago
        </span>
      </div>
      {invitee.summary && (
        <p className="text-xs italic text-neutral-700">{invitee.summary}</p>
      )}
      {invitee.reply_text && (
        <blockquote className="rounded bg-neutral-50 p-2 text-xs text-neutral-700 whitespace-pre-wrap">
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
    <li className="rounded border border-neutral-200 bg-white p-3 space-y-1 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <strong>{invitee.contact_name}</strong>
        <span className="text-xs text-neutral-500">invited {invitee.days_since_sent}d ago</span>
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
    <section className="space-y-4 rounded border border-neutral-200 bg-white p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-lg font-semibold tracking-tight">RSVP summary</h3>
        <span className="text-xs text-neutral-500">{total} sent invitations</span>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1">
          <p className="text-xs font-medium tracking-wide text-green-800">
            ✓ YES ({data.yes.length})
          </p>
          {data.yes.length === 0 ? (
            <p className="text-xs text-neutral-500">No yeses yet.</p>
          ) : (
            <p className="text-sm text-neutral-800">
              {data.yes.map((y) => y.contact_name).join(', ')}
            </p>
          )}
        </div>

        <div className="space-y-1">
          <p className="text-xs font-medium tracking-wide text-red-800">
            ✕ NO ({data.no.length})
          </p>
          {data.no.length === 0 ? (
            <p className="text-xs text-neutral-500">No declines.</p>
          ) : (
            <p className="text-sm text-neutral-800">
              {data.no.map((n) => n.contact_name).join(', ')}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium tracking-wide text-amber-800">
          ? MAYBE ({data.maybe.length})
        </p>
        {data.maybe.length === 0 ? (
          <p className="text-xs text-neutral-500">No maybes.</p>
        ) : (
          <ul className="space-y-2">
            {data.maybe.map((i) => (
              <InviteeCard key={i.invite_id} invitee={i} />
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium tracking-wide text-neutral-700">
          … UNCLEAR ({data.unclear.length})
        </p>
        {data.unclear.length === 0 ? (
          <p className="text-xs text-neutral-500">Nothing unclear.</p>
        ) : (
          <ul className="space-y-2">
            {data.unclear.map((i) => (
              <InviteeCard key={i.invite_id} invitee={i} />
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium tracking-wide text-neutral-700">
          · NO REPLY YET ({data.no_reply_yet.length})
        </p>
        {data.no_reply_yet.length === 0 ? (
          <p className="text-xs text-neutral-500">Everyone has responded.</p>
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
