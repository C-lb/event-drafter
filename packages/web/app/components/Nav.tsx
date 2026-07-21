'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { CHECK_NOW_EVENT } from '../replies/CheckNowButton';

// One icon family: Feather-style, stroke 2, sized to the label's line height.
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[1.05em] w-[1.05em] flex-none"
      aria-hidden
    >
      {children}
    </svg>
  );
}

const NAV: { href: string; label: string; icon: ReactNode }[] = [
  { href: '/', label: 'Home', icon: <><path d="M3 11.5 12 4l9 7.5" /><path d="M5 10v10h14V10" /></> },
  { href: '/events', label: 'Events', icon: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></> },
  { href: '/replies', label: 'Replies', icon: <><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></> },
  { href: '/follow-ups', label: 'Follow-ups', icon: <><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v4h4" /></> },
  { href: '/status', label: 'Status', icon: <><path d="M3 12h4l2 6 4-14 2 8h6" /></> },
  { href: '/setup', label: 'Setup', icon: <><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" /></> },
];

// Browser-style history controls. Back/forward walk the SPA history; reload
// does a real hard refresh of the page.
function HistoryControls() {
  const router = useRouter();
  const [spun, setSpun] = useState(false);
  const [hint, setHint] = useState(false);
  const btn =
    'inline-flex items-center justify-center rounded-btn p-1.5 text-ink-2 transition hover:bg-line hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:bg-line-strong';

  // "Check now" enqueues an async worker job, so the reply list won't update
  // on its own. Surface a reminder on the reload button while that check is
  // likely still in flight.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const onCheckNow = () => {
      setHint(true);
      clearTimeout(timer);
      timer = setTimeout(() => setHint(false), 6000);
    };
    window.addEventListener(CHECK_NOW_EVENT, onCheckNow);
    return () => {
      window.removeEventListener(CHECK_NOW_EVENT, onCheckNow);
      clearTimeout(timer);
    };
  }, []);

  return (
    <div className="flex items-center gap-1 pr-1">
      <button type="button" onClick={() => router.back()} className={btn} title="Go back" aria-label="Go back">
        <Icon><path d="m15 18-6-6 6-6" /></Icon>
      </button>
      <button type="button" onClick={() => router.forward()} className={btn} title="Go forward" aria-label="Go forward">
        <Icon><path d="m9 18 6-6-6-6" /></Icon>
      </button>
      <div className="relative">
        <button
          type="button"
          onClick={() => {
            setSpun(true);
            setHint(false);
            window.location.reload();
          }}
          className={btn}
          title="Reload this page"
          aria-label="Reload this page"
        >
          <span className={spun ? 'inline-flex animate-spin' : 'inline-flex'}>
            <Icon><><path d="M23 4v6h-6" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></></Icon>
          </span>
        </button>
        {hint && (
          <div
            role="status"
            className="absolute left-1/2 top-full z-30 mt-2 w-48 -translate-x-1/2 rounded-md bg-ink px-3 py-2 text-xs text-white shadow-raise"
          >
            <span className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-ink" aria-hidden />
            Checking for new replies. Click refresh to see them.
          </div>
        )}
      </div>
    </div>
  );
}

export function Nav() {
  const pathname = usePathname() || '/';
  return (
    <nav className="flex flex-wrap items-center gap-1">
      <HistoryControls />
      <span className="mr-1 h-5 w-px flex-none bg-line" aria-hidden />
      {NAV.map((item) => {
        const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`inline-flex items-center gap-2 rounded-btn px-3 py-1.5 text-sm font-medium transition ${
              active
                ? 'bg-ink text-white shadow-raise'
                : 'text-ink-2 hover:bg-line hover:text-ink'
            }`}
          >
            <Icon>{item.icon}</Icon>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
