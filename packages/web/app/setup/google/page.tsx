import Link from 'next/link';
import { getSetting } from '@event-drafter/core/settings';
import { saveGoogleCredentials } from '../actions';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function GoogleSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const tokens = getSetting('google_tokens');
  const params = await searchParams;

  // Credentials: settings take priority over env (packaged app has no .env).
  const clientId = getSetting('google_client_id') ?? process.env.GOOGLE_CLIENT_ID ?? '';
  const clientSecret = getSetting('google_client_secret') ?? process.env.GOOGLE_CLIENT_SECRET ?? '';
  const hasCredentials = Boolean(clientId && clientSecret);

  // Redirect URI: injected by desktop runtime; fall back to common dev value.
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ?? 'http://127.0.0.1:41000/api/auth/google/callback';

  async function saveAndRefresh(data: FormData) {
    'use server';
    await saveGoogleCredentials(data);
    redirect('/setup/google');
  }

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <p className="eyebrow">Step 2</p>
        <h2 className="text-2xl font-semibold tracking-tight">Connect Google</h2>
      </div>

      {params?.error && (
        <p className="rounded-card bg-red-50 p-4 text-sm text-red-700 ring-1 ring-inset ring-red-600/20">
          Error: {params.error}
        </p>
      )}

      {/* GCP credentials */}
      <div className="space-y-3">
        <h3 className="text-base font-medium text-ink-1">GCP credentials</h3>
        <p className="text-sm text-ink-2">
          Create an OAuth 2.0 client in{' '}
          <a
            className="font-medium text-accent hover:text-accent-hover"
            href="https://console.cloud.google.com/apis/credentials"
            target="_blank"
            rel="noopener noreferrer"
          >
            Google Cloud Console
          </a>
          , add the redirect URI below as an authorised redirect, then paste the credentials here.
        </p>
        <div className="card p-4 text-xs text-ink-2 space-y-1">
          <p className="font-medium text-ink-1">Authorised redirect URI to register in Google Console</p>
          <code className="block break-all">{redirectUri}</code>
          <p className="text-ink-3">
            For dev (<code>npm run dev</code>): <code>http://localhost:3000/api/auth/google/callback</code>
          </p>
        </div>

        {hasCredentials ? (
          <>
            <p className="rounded-card bg-emerald-50 p-4 text-sm text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
              &#10003; Credentials saved. Client ID: <code>{clientId.slice(0, 12)}...</code>
            </p>
            <details className="text-sm">
              <summary className="cursor-pointer text-ink-3 hover:text-ink-2">Update credentials</summary>
              <form action={saveAndRefresh} className="mt-3 space-y-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-ink-1" htmlFor="google_client_id_update">
                    Client ID
                  </label>
                  <input
                    id="google_client_id_update"
                    name="google_client_id"
                    type="text"
                    defaultValue={clientId}
                    className="field w-full"
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-ink-1" htmlFor="google_client_secret_update">
                    Client secret
                  </label>
                  <input
                    id="google_client_secret_update"
                    name="google_client_secret"
                    type="password"
                    placeholder="GOCSPX-..."
                    className="field w-full"
                    autoComplete="off"
                  />
                </div>
                <button type="submit" className="btn">Save credentials</button>
              </form>
            </details>
          </>
        ) : (
          <form action={saveAndRefresh} className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink-1" htmlFor="google_client_id">
                Client ID
              </label>
              <input
                id="google_client_id"
                name="google_client_id"
                type="text"
                placeholder="123456789-abc...apps.googleusercontent.com"
                className="field w-full"
                autoComplete="off"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink-1" htmlFor="google_client_secret">
                Client secret
              </label>
              <input
                id="google_client_secret"
                name="google_client_secret"
                type="password"
                placeholder="GOCSPX-..."
                className="field w-full"
                autoComplete="off"
              />
            </div>
            <button type="submit" className="btn-primary">Save credentials</button>
          </form>
        )}
      </div>

      {/* OAuth authorization */}
      {hasCredentials && (
        <div className="space-y-3">
          <h3 className="text-base font-medium text-ink-1">Authorization</h3>
          {tokens ? (
            <>
              <p className="rounded-card bg-emerald-50 p-4 text-sm text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                &#10003; Authorized. Scopes: {tokens.scope}
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
            </>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-ink-2">Click below to open Google sign-in and grant access.</p>
              <a href="/api/auth/google/start" className="btn-primary inline-flex">
                Authorize Google
              </a>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
