'use client';

import { useEffect, useRef } from 'react';
import { useToast } from './ToastProvider';
import { getSetupStatus } from './actions';

// Shown once per browser session so it greets you on open without nagging on
// every navigation.
const SESSION_KEY = 'ed-boot-status-shown';

export function BootStatusToast() {
  const { show } = useToast();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    try {
      if (sessionStorage.getItem(SESSION_KEY)) return;
    } catch {
      // sessionStorage unavailable (private mode); fall through and show once.
    }

    (async () => {
      const res = await getSetupStatus();
      if (!res.ok) return; // could not read setup state; stay quiet
      try {
        sessionStorage.setItem(SESSION_KEY, '1');
      } catch {
        /* ignore */
      }

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
