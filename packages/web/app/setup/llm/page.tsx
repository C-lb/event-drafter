import { markLLMReady } from '../actions';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

const PROVIDER = (process.env.LLM_PROVIDER ?? 'ollama') as 'ollama' | 'anthropic';
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:7b-instruct';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';

async function probeOllama(): Promise<
  | { ok: true; models: string[]; hasModel: boolean }
  | { ok: false; error: string }
> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    const models = (data.models ?? []).map((m) => m.name);
    const hasModel = models.some((n) => n === OLLAMA_MODEL || n.startsWith(`${OLLAMA_MODEL}:`));
    return { ok: true, models, hasModel };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export default async function LLMSetupPage() {
  const hasAnthropicKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const ollamaProbe = PROVIDER === 'ollama' ? await probeOllama() : null;
  const ready =
    PROVIDER === 'anthropic'
      ? hasAnthropicKey
      : Boolean(ollamaProbe?.ok && (ollamaProbe as { ok: true; hasModel: boolean }).hasModel);

  async function confirm() {
    'use server';
    await markLLMReady(true);
    redirect('/setup/google');
  }

  return (
    <section className="max-w-xl space-y-4">
      <h2 className="text-xl font-semibold">Step 1 — LLM provider</h2>
      <p className="text-sm text-neutral-700">
        Active provider: <strong>{PROVIDER}</strong>
        {' · '}
        <span className="text-neutral-500">
          Switch by setting <code>LLM_PROVIDER</code> in <code>.env</code> to <code>ollama</code> or <code>anthropic</code>.
        </span>
      </p>

      {PROVIDER === 'ollama' && (
        <div className="space-y-3">
          <p className="text-sm">Drafts, classification, and follow-ups run on a local Ollama model. Nothing leaves your machine.</p>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>Install: <code className="rounded bg-neutral-100 px-1">brew install --cask ollama-app</code></li>
            <li>Start: <code className="rounded bg-neutral-100 px-1">open -a Ollama</code></li>
            <li>Pull model: <code className="rounded bg-neutral-100 px-1">ollama pull {OLLAMA_MODEL}</code></li>
          </ol>
          <div className="rounded border border-neutral-200 bg-white p-3 text-xs">
            <p>Base URL: <code>{OLLAMA_BASE_URL}</code></p>
            <p>Model: <code>{OLLAMA_MODEL}</code></p>
            <p className="mt-2">
              {ollamaProbe?.ok ? (
                (ollamaProbe as { hasModel: boolean }).hasModel ? (
                  <span className="text-green-700">✓ Ollama reachable and model is pulled.</span>
                ) : (
                  <span className="text-amber-700">! Reachable but model not pulled. Run <code>ollama pull {OLLAMA_MODEL}</code>.</span>
                )
              ) : (
                <span className="text-red-700">✗ Cannot reach Ollama ({(ollamaProbe as { error: string }).error}).</span>
              )}
            </p>
            {ollamaProbe?.ok && (ollamaProbe as { models: string[] }).models.length > 0 && (
              <p className="mt-1 text-neutral-600">Installed: {(ollamaProbe as { models: string[] }).models.join(', ')}</p>
            )}
          </div>
        </div>
      )}

      {PROVIDER === 'anthropic' && (
        <div className="space-y-3">
          <p className="text-sm">
            Drafts, classification, and follow-ups call the Anthropic API. Lower latency and higher quality than local models, but contact data is sent to Claude.
          </p>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>Get a key at <a className="underline" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">console.anthropic.com</a>.</li>
            <li>Add <code>ANTHROPIC_API_KEY=sk-ant-…</code> to your <code>.env</code>.</li>
            <li>Restart <code>npm run dev</code>.</li>
          </ol>
          <div className="rounded border border-neutral-200 bg-white p-3 text-xs">
            <p>Model: <code>{ANTHROPIC_MODEL}</code></p>
            <p className="mt-2">
              {hasAnthropicKey ? (
                <span className="text-green-700">✓ API key detected.</span>
              ) : (
                <span className="text-red-700">✗ <code>ANTHROPIC_API_KEY</code> missing — add it to <code>.env</code> and restart.</span>
              )}
            </p>
          </div>
        </div>
      )}

      <form action={confirm}>
        <button
          type="submit"
          disabled={!ready}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Confirm
        </button>
      </form>
    </section>
  );
}
