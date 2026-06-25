'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

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

export function Nav() {
  const pathname = usePathname() || '/';
  return (
    <nav className="flex flex-wrap items-center gap-1">
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
