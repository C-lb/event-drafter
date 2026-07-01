'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

export type ToastTone = 'success' | 'error' | 'warning' | 'info' | 'loading';

export interface ToastAction {
  label: string;
  href?: string;
  onClick?: () => void;
  variant?: 'solid' | 'ghost';
}

export interface ToastOptions {
  tone?: ToastTone;
  title: string;
  meta?: string;
  body?: ReactNode;
  actions?: ToastAction[];
  /** ms before auto-dismiss; null = sticky. Default: 5.5s for success/info/warning, sticky for loading/error. */
  duration?: number | null;
  sparkle?: boolean;
  dismissible?: boolean;
}

interface ToastItem extends ToastOptions {
  id: number;
  tone: ToastTone;
}

interface ToastApi {
  show: (opts: ToastOptions) => number;
  update: (id: number, patch: Partial<ToastOptions>) => void;
  dismiss: (id: number) => void;
}

const ToastCtx = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}

function defaultDuration(tone: ToastTone, given?: number | null): number | null {
  if (given !== undefined) return given;
  if (tone === 'loading' || tone === 'error') return null;
  return 5500;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const clearTimer = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
  }, []);

  const dismiss = useCallback(
    (id: number) => {
      clearTimer(id);
      setToasts((prev) => prev.filter((t) => t.id !== id));
    },
    [clearTimer],
  );

  const arm = useCallback(
    (id: number, duration: number | null) => {
      clearTimer(id);
      if (duration != null) timers.current.set(id, setTimeout(() => dismiss(id), duration));
    },
    [clearTimer, dismiss],
  );

  const show = useCallback(
    (opts: ToastOptions) => {
      const id = ++idRef.current;
      const tone = opts.tone ?? 'info';
      setToasts((prev) => [...prev, { ...opts, id, tone }]);
      arm(id, defaultDuration(tone, opts.duration));
      return id;
    },
    [arm],
  );

  const update = useCallback(
    (id: number, patch: Partial<ToastOptions>) => {
      setToasts((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...patch, tone: patch.tone ?? t.tone } : t)),
      );
      if (patch.tone !== undefined) arm(id, defaultDuration(patch.tone, patch.duration));
      else if (patch.duration !== undefined) arm(id, patch.duration);
    },
    [arm],
  );

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((t) => clearTimeout(t));
  }, []);

  const api = useMemo(() => ({ show, update, dismiss }), [show, update, dismiss]);

  return (
    <ToastCtx.Provider value={api}>
      {children}
      {mounted &&
        createPortal(
          <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-end gap-3 p-4 sm:p-6">
            {toasts.map((t) => (
              <ToastCard key={t.id} toast={t} onClose={() => dismiss(t.id)} />
            ))}
          </div>,
          document.body,
        )}
    </ToastCtx.Provider>
  );
}

// --- Presentation ----------------------------------------------------------

function Icon({ tone }: { tone: ToastTone }) {
  const common = 'h-5 w-5';
  if (tone === 'loading') {
    return (
      <svg className={`${common} animate-spin`} viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2.5" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    );
  }
  const stroke = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className: common,
    'aria-hidden': true,
  };
  if (tone === 'success') return <svg {...stroke}><path d="M20 6 9 17l-5-5" /></svg>;
  if (tone === 'error') return <svg {...stroke}><path d="M18 6 6 18M6 6l12 12" /></svg>;
  if (tone === 'warning')
    return (
      <svg {...stroke}>
        <path d="M10.3 3.6 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0Z" />
        <path d="M12 9v4M12 17h.01" />
      </svg>
    );
  return (
    <svg {...stroke}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  );
}

// Solid icon tile per tone. Loading is a quiet neutral tile; the rest carry the
// semantic hue (green success, red danger, amber warning, blue info).
const TILE: Record<ToastTone, string> = {
  success: 'bg-emerald-500 text-white',
  error: 'bg-red-500 text-white',
  warning: 'bg-amber-500 text-white',
  info: 'bg-blue-500 text-white',
  loading: 'bg-white/10 text-white/70',
};

function ToastCard({ toast, onClose }: { toast: ToastItem; onClose: () => void }) {
  const dismissible = toast.dismissible !== false;
  return (
    <div
      role="status"
      aria-live="polite"
      className="ed-toast-enter pointer-events-auto relative w-[min(92vw,26rem)] rounded-2xl bg-[#17171b] p-4 pr-9 text-white shadow-[0_24px_60px_-16px_rgba(0,0,0,0.55)] ring-1 ring-white/10"
    >
      {toast.tone === 'success' && toast.sparkle && <SparkleBurst />}

      {dismissible && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss"
          className="absolute right-2.5 top-2.5 grid h-6 w-6 place-items-center rounded-md text-white/40 transition hover:bg-white/10 hover:text-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-3.5 w-3.5" aria-hidden>
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      )}

      <div className="flex items-start gap-3">
        <span className={`relative z-10 grid h-10 w-10 flex-none place-items-center rounded-[12px] ${TILE[toast.tone]}`}>
          <Icon tone={toast.tone} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-[15px] font-semibold leading-tight">
            <span className="truncate">{toast.title}</span>
            {toast.meta && (
              <span className="flex-none text-[13px] font-normal text-white/40">| {toast.meta}</span>
            )}
          </p>
          {toast.body && <div className="mt-1 text-[13px] leading-snug text-white/60">{toast.body}</div>}
          {toast.actions && toast.actions.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {toast.actions.map((a, i) => {
                const cls =
                  a.variant === 'solid'
                    ? 'rounded-[10px] bg-white px-3 py-1.5 text-[13px] font-semibold text-[#17171b] transition hover:bg-white/90'
                    : 'rounded-[10px] px-3 py-1.5 text-[13px] font-medium text-white/80 ring-1 ring-inset ring-white/15 transition hover:bg-white/5';
                if (a.href) {
                  return (
                    <a key={i} href={a.href} onClick={onClose} className={cls}>
                      {a.label}
                    </a>
                  );
                }
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      a.onClick?.();
                      onClose();
                    }}
                    className={cls}
                  >
                    {a.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// A brief celebratory sparkle burst around the icon on success. Decorative, so
// it is hidden under prefers-reduced-motion (see globals.css). Palette kept to a
// tight accent-adjacent set (blues/violets) plus success green.
const SPARKLES: { c: string; tx: string; ty: string; d: string; s: number }[] = [
  { c: '#34d399', tx: '-24px', ty: '-30px', d: '0ms', s: 9 },
  { c: '#60a5fa', tx: '12px', ty: '-34px', d: '40ms', s: 6 },
  { c: '#a78bfa', tx: '34px', ty: '-16px', d: '90ms', s: 8 },
  { c: '#818cf8', tx: '-34px', ty: '-8px', d: '60ms', s: 5 },
  { c: '#22d3ee', tx: '4px', ty: '-40px', d: '120ms', s: 6 },
  { c: '#c084fc', tx: '40px', ty: '-30px', d: '150ms', s: 6 },
  { c: '#34d399', tx: '-40px', ty: '-24px', d: '130ms', s: 5 },
  { c: '#60a5fa', tx: '24px', ty: '-38px', d: '100ms', s: 5 },
];

function SparkleBurst() {
  return (
    <span aria-hidden className="pointer-events-none absolute left-[30px] top-[30px] z-20 h-0 w-0">
      {SPARKLES.map((s, i) => (
        <span
          key={i}
          className="ed-sparkle absolute block"
          style={
            {
              width: s.s,
              height: s.s,
              marginLeft: -s.s / 2,
              marginTop: -s.s / 2,
              color: s.c,
              animationDelay: s.d,
              ['--tx' as string]: s.tx,
              ['--ty' as string]: s.ty,
            } as CSSProperties
          }
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-full w-full">
            <path d="M12 0c.6 6 3.4 9.4 12 12-8.6 2.6-11.4 6-12 12-.6-6-3.4-9.4-12-12C8.6 9.4 11.4 6 12 0Z" />
          </svg>
        </span>
      ))}
    </span>
  );
}
