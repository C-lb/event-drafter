'use client';

import { useTransition } from 'react';
import { triggerReplyCheck } from './actions';

// Checking runs as an async worker job, so the reply list doesn't update
// instantly. Firing this event lets the navbar's reload button surface a
// reminder to refresh once the check is under way.
export const CHECK_NOW_EVENT = 'ed:check-now';

export function CheckNowButton({ inFlight }: { inFlight: boolean }) {
  const [isPending, start] = useTransition();

  const run = () => {
    start(async () => {
      await triggerReplyCheck();
      window.dispatchEvent(new Event(CHECK_NOW_EVENT));
    });
  };

  return (
    <button
      type="button"
      onClick={run}
      disabled={inFlight || isPending}
      className="btn-primary btn-sm"
    >
      {inFlight || isPending ? 'Checking…' : 'Check now'}
    </button>
  );
}
