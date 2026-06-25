import Link from 'next/link';
import { use } from 'react';
import { getSetting } from '@event-drafter/core/settings';

export const dynamic = 'force-dynamic';

export default function GoogleSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const tokens = getSetting('google_tokens');
  const params = use(searchParams);

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <p className="eyebrow">Step 2</p>
        <h2 className="text-2xl font-semibold tracking-tight">Connect Google</h2>
      </div>
      <p className="text-sm text-ink-2">
        See <code>docs/setup/google-oauth.md</code> for the one-time GCP setup.
        After that, click below to authorize this app.
      </p>
      {params?.error && (
        <p className="rounded-card bg-red-50 p-4 text-sm text-red-700 ring-1 ring-inset ring-red-600/20">Error: {params.error}</p>
      )}
      {tokens ? (
        <div className="space-y-3">
          <p className="rounded-card bg-emerald-50 p-4 text-sm text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
            ✓ Authorized. Scopes: {tokens.scope}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/setup/sheet" className="btn-primary inline-flex">
              Continue
            </Link>
            <a href="/api/auth/google/start" className="btn inline-flex">
              Re-authorize
            </a>
          </div>
          <p className="text-sm text-ink-3">
            If replies or contact sync stopped working, the saved login has expired.
            Re-authorize to get a fresh one.
          </p>
        </div>
      ) : (
        <a href="/api/auth/google/start" className="btn-primary inline-flex">
          Authorize Google
        </a>
      )}
    </section>
  );
}
