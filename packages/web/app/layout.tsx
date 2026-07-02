import './globals.css';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { DM_Sans } from 'next/font/google';
import { SetupBanner } from './components/SetupBanner';
import { Nav } from './components/Nav';
import { WorkerStatus } from './components/WorkerStatus';
import { ToastProvider } from './components/toast/ToastProvider';
import { BootStatusToast } from './components/toast/BootStatusToast';
import { WorkerActivityToasts } from './components/toast/WorkerActivityToasts';

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata = { title: 'Event Drafter' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={dmSans.variable}>
      <body className="min-h-screen bg-canvas text-ink antialiased">
        <ToastProvider>
        <header className="sticky top-0 z-30 border-b border-line bg-surface/85 backdrop-blur-md">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-3.5">
            <Link href="/" className="inline-flex items-center gap-2.5">
              <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-ink text-white shadow-raise">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
                  <rect x="3" y="5" width="18" height="16" rx="2" />
                  <path d="M16 3v4M8 3v4M3 10h18M9 14l2 2 4-4" />
                </svg>
              </span>
              <span className="text-[15px] font-semibold tracking-tight">Event Drafter</span>
            </Link>
            <div className="flex flex-wrap items-center gap-3">
              <Nav />
              <WorkerStatus />
            </div>
          </div>
        </header>
        {/* Full-width worker-offline banner mounts here (portal target). */}
        <div id="worker-banner-slot" />
        <SetupBanner />
        <BootStatusToast />
        <WorkerActivityToasts />
        <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
        </ToastProvider>
      </body>
    </html>
  );
}
