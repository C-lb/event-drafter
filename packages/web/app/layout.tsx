import './globals.css';
import type { ReactNode } from 'react';

export const metadata = { title: 'VIP Event Drafter' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-50 text-neutral-900">
        <header className="border-b border-neutral-200 px-6 py-3">
          <h1 className="text-lg font-semibold">VIP Event Drafter</h1>
        </header>
        <main className="px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
