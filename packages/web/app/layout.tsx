import './globals.css';
import type { ReactNode } from 'react';
import { SetupBanner } from './components/SetupBanner';

export const metadata = { title: 'Event Drafter' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-50 text-neutral-900">
        <header className="border-b border-neutral-200 px-8 py-5 flex items-center justify-between gap-6">
          <h1 className="text-xl font-semibold tracking-tight">Event Drafter</h1>
          <nav className="flex gap-6 text-base tracking-wide">
            <a href="/" className="hover:underline">home</a>
            <a href="/events" className="hover:underline">events</a>
            <a href="/replies" className="hover:underline">replies</a>
            <a href="/follow-ups" className="hover:underline">follow-ups</a>
            <a href="/status" className="hover:underline">status</a>
            <a href="/setup" className="hover:underline">setup</a>
          </nav>
        </header>
        <SetupBanner />
        <main className="px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
