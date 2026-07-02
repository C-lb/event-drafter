'use client';

import { useEffect, useRef, useState } from 'react';
import { createDeferredSend, type SendState } from './deferred-send';

export function useDeferredSend(onSend: () => Promise<void>, delayMs = 3000) {
  const [state, setState] = useState<SendState>({ phase: 'idle' });

  // Always call the freshest onSend without re-creating the controller. The ref
  // is updated in an effect (after commit) rather than during render so reads
  // stay outside the render phase.
  const onSendRef = useRef(onSend);
  useEffect(() => {
    onSendRef.current = onSend;
  });

  // Lazy useState initializer runs exactly once and gives a stable controller
  // instance without touching a ref during render. The onSend closure only
  // dereferences onSendRef inside the controller's setTimeout callback (never at
  // construction time), so this read never happens during render.
  // eslint-disable-next-line react-hooks/refs
  const [ctrl] = useState(() =>
    createDeferredSend({
      onSend: () => onSendRef.current(),
      delayMs,
      onChange: setState,
    }),
  );

  // Tradeoff: if the card unmounts during the 3 s undo window (e.g. a hot
  // reload or an unlikely router reconciliation that destroys the node), dispose
  // fires here and clears the pending timer — the send is dropped silently.
  // This is acceptable: the queue suppresses refresh while busy, and
  // router.refresh() reconciles by key without unmounting live cards.
  useEffect(() => () => ctrl.dispose(), [ctrl]);

  return {
    state,
    send: () => ctrl.send(),
    undo: () => ctrl.undo(),
  };
}
