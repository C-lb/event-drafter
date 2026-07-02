'use client';

import { useEffect, useRef } from 'react';
import { useToast } from './ToastProvider';
import { getSetupStatus } from './actions';

// Fires on every full page load (refresh) but not on soft in-app navigation:
// the ref survives client-side route changes because this lives in the
// persistent layout, and only resets on a real reload.
export function BootStatusToast() {
  const { show } = useToast();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    (async () => {
      const res = await getSetupStatus();
      if (!res.ok) return; // could not read setup state; stay quiet

      if (res.missing.length === 0) {
        show({
          tone: 'success',
          title: 'You are all set',
          meta: 'setup complete',
          body: 'Every setup step is done. Event Drafter is ready to go.',
          sparkle: true,
        });
      } else {
        show({
          tone: 'warning',
          title: 'Finish setting up',
          meta: `${res.missing.length} of ${res.total} left`,
          body: (
            <>
              Still to configure: {res.missing.map((m) => m.label).join(', ')}.
            </>
          ),
          duration: null,
          actions: [{ label: 'Open setup', href: '/setup', variant: 'solid' }],
        });
      }
    })();
  }, [show]);

  return null;
}
