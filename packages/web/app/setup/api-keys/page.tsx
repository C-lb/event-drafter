import { markAnthropicKeySet } from '../actions';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function ApiKeysPage() {
  const hasEnvKey = Boolean(process.env.ANTHROPIC_API_KEY);

  async function confirm() {
    'use server';
    await markAnthropicKeySet(true);
    redirect('/setup/google');
  }

  return (
    <section className="max-w-xl space-y-4">
      <h2 className="text-xl font-semibold">Step 1 — Anthropic API key</h2>
      <p className="text-sm text-neutral-700">
        Add <code>ANTHROPIC_API_KEY</code> to your <code>.env</code> file in the repo root.
        Get a key at <a className="underline" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">console.anthropic.com</a>.
      </p>
      <p className="text-sm">
        Detected in <code>.env</code>: <strong>{hasEnvKey ? 'yes' : 'no — restart the dev server after adding'}</strong>
      </p>
      <form action={confirm}>
        <button
          type="submit"
          disabled={!hasEnvKey}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Confirm
        </button>
      </form>
    </section>
  );
}
