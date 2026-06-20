'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AutoRefresh } from '../components/AutoRefresh';
import { stepHighlight, advanceHighlight } from './queue-nav';

export interface CardHandlers {
  primary: () => void;
  focusEditor: () => void;
  isTerminal: () => boolean;
}

export interface QueueApi {
  highlightedId: number | null;
  registerCard: (id: number, h: CardHandlers) => () => void;
  addPending: (id: number) => void;
  removePending: (id: number) => void;
}

const QueueCtx = createContext<QueueApi | null>(null);

export function useQueue(): QueueApi {
  const ctx = useContext(QueueCtx);
  if (!ctx) throw new Error('useQueue must be used within <QueueProvider>');
  return ctx;
}

function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

export function QueueProvider({
  orderedIds,
  active,
  children,
}: {
  orderedIds: number[];
  active: boolean;
  children: ReactNode;
}) {
  const [highlightedId, setHighlightedId] = useState<number | null>(null);
  const [pending, setPending] = useState<Set<number>>(() => new Set());
  const cards = useRef<Map<number, CardHandlers>>(new Map());

  const addPending = useCallback((id: number) => {
    setPending((p) => {
      const n = new Set(p);
      n.add(id);
      return n;
    });
  }, []);
  const removePending = useCallback((id: number) => {
    setPending((p) => {
      const n = new Set(p);
      n.delete(id);
      return n;
    });
  }, []);

  const registerCard = useCallback((id: number, h: CardHandlers) => {
    cards.current.set(id, h);
    return () => {
      cards.current.delete(id);
    };
  }, []);

  const isTerminal = useCallback(
    (id: number) => cards.current.get(id)?.isTerminal() ?? false,
    [],
  );

  // Keep the latest orderedIds/highlightedId readable inside the keydown
  // listener without re-binding it on every render.
  const navRef = useRef({ orderedIds, highlightedId, isTerminal });
  navRef.current = { orderedIds, highlightedId, isTerminal };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isEditableTarget(document.activeElement)) {
          (document.activeElement as HTMLElement).blur();
          e.preventDefault();
        }
        return;
      }
      if (isEditableTarget(e.target)) return;

      const { orderedIds: ids, highlightedId: cur, isTerminal: term } = navRef.current;

      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightedId(stepHighlight(ids, cur, term, 1));
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedId(stepHighlight(ids, cur, term, -1));
      } else if (e.key === 'Enter') {
        if (cur === null) return;
        e.preventDefault();
        cards.current.get(cur)?.primary();
        // The actioned card becomes terminal synchronously (collapse / sending);
        // a microtask lets that settle before we advance off it.
        queueMicrotask(() => {
          const n = navRef.current;
          setHighlightedId(advanceHighlight(n.orderedIds, cur, n.isTerminal));
        });
      } else if (e.key === 'e') {
        if (cur === null) return;
        e.preventDefault();
        cards.current.get(cur)?.focusEditor();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const busy = highlightedId !== null || pending.size > 0;

  const api = useMemo<QueueApi>(
    () => ({ highlightedId, registerCard, addPending, removePending }),
    [highlightedId, registerCard, addPending, removePending],
  );

  return (
    <QueueCtx.Provider value={api}>
      <AutoRefresh active={active && !busy} />
      {children}
    </QueueCtx.Provider>
  );
}
