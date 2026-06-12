'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  /**
   * While true, the parent Server Component is re-rendered every `intervalMs`
   * via `router.refresh()`. Pass `inFlight` (queued || running for whatever
   * job kind this page cares about) so polling stops as soon as work is done.
   */
  active: boolean;
  /** Polling cadence. 1500ms matches the ResyncButton on /contacts. */
  intervalMs?: number;
}

/**
 * Drop-in client component for Server Components that need to reflect job
 * progress without forcing the operator to hit reload. Renders nothing
 * visible; only triggers `router.refresh()` on a timer while `active` is true.
 *
 * Pattern:
 *   const inFlight = lastJob?.status === 'queued' || lastJob?.status === 'running';
 *   return (
 *     <>
 *       <AutoRefresh active={inFlight} />
 *       ...rest of the page...
 *     </>
 *   );
 */
export function AutoRefresh({ active, intervalMs = 1500 }: Props) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs, router]);
  return null;
}
