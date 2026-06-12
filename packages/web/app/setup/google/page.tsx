import Link from 'next/link';
import { use } from 'react';
import { getSetting } from '@vip/core/settings';

export const dynamic = 'force-dynamic';

export default function GoogleSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const tokens = getSetting('google_tokens');
  const params = use(searchParams);

  return (
    <section className="max-w-xl space-y-4">
      <h2 className="text-3xl font-semibold tracking-tight">Step 2 — Connect Google</h2>
      <p className="text-sm text-neutral-700">
        See <code>docs/setup/google-oauth.md</code> for the one-time GCP setup.
        After that, click below to authorize this app.
      </p>
      {params?.error && (
        <p className="rounded bg-red-50 p-3 text-sm text-red-700">Error: {params.error}</p>
      )}
      {tokens ? (
        <div className="space-y-2">
          <p className="rounded bg-green-50 p-3 text-sm text-green-700">
            ✓ Authorized. Scopes: {tokens.scope}
          </p>
          <Link href="/setup/sheet" className="inline-block rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white">
            Continue
          </Link>
        </div>
      ) : (
        <a href="/api/auth/google/start" className="inline-block rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white">
          Authorize Google
        </a>
      )}
    </section>
  );
}
