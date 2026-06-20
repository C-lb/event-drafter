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

  useEffect(() => () => ctrl.current?.dispose(), []);

  return {
    state,
    send: () => ctrl.current!.send(),
    undo: () => ctrl.current!.undo(),
  };
}
