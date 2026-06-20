/**
 * Framework-agnostic Gmail-style deferred send. `send()` starts a timer; the
 * real `onSend` only fires after `delayMs`, so `undo()` within the window
 * cancels it before anything is enqueued. Unit-tested with fake timers in
 * deferred-send.test.ts; wrapped by the useDeferredSend React hook.
 */
export type SendState =
  | { phase: 'idle' }
  | { phase: 'sending' }
  | { phase: 'sent' }
  | { phase: 'error'; message: string };

export interface DeferredSend {
  readonly state: SendState;
  send(): void;
  undo(): void;
  dispose(): void;
}

export function createDeferredSend(opts: {
  onSend: () => Promise<void>;
  delayMs: number;
  onChange: (s: SendState) => void;
}): DeferredSend {
  let state: SendState = { phase: 'idle' };
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const set = (s: SendState) => {
    state = s;
    opts.onChange(s);
  };

  return {
    get state() {
      return state;
    },
    send() {
      if (disposed || state.phase !== 'idle') return;
      set({ phase: 'sending' });
      timer = setTimeout(async () => {
        timer = null;
        try {
          await opts.onSend();
          if (!disposed) {
            set({ phase: 'sent' });
          }
        } catch (e) {
          if (!disposed) {
            set({ phase: 'error', message: e instanceof Error ? e.message : 'send failed' });
          }
        }
      }, opts.delayMs);
    },
    undo() {
      if (state.phase !== 'sending') return;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      set({ phase: 'idle' });
    },
    dispose() {
      disposed = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
