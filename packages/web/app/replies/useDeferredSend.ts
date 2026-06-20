'use client';

import { useEffect, useRef, useState } from 'react';
import { createDeferredSend, type DeferredSend, type SendState } from './deferred-send';

export function useDeferredSend(onSend: () => Promise<void>, delayMs = 3000) {
  const [state, setState] = useState<SendState>({ phase: 'idle' });

  // Always call the freshest onSend without re-creating the controller.
  const onSendRef = useRef(onSend);
  onSendRef.current = onSend;

  const ctrl = useRef<DeferredSend | null>(null);
  if (ctrl.current === null) {
    ctrl.current = createDeferredSend({
      onSend: () => onSendRef.current(),
      delayMs,
      onChange: setState,
    });
  }

  // Tradeoff: if the card unmounts during the 3 s undo window (e.g. a hot
  // reload or an unlikely router reconciliation that destroys the node), dispose
  // fires here and clears the pending timer — the send is dropped silently.
  // This is acceptable: the queue suppresses refresh while busy, and
  // router.refresh() reconciles by key without unmounting live cards.
  useEffect(() => () => ctrl.current?.dispose(), []);

  return {
    state,
    send: () => ctrl.current!.send(),
    undo: () => ctrl.current!.undo(),
  };
}
