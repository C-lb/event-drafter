import { markLLMReady, saveLLMConfig } from '../actions';
import { redirect } from 'next/navigation';
import { getSetting } from '@event-drafter/core/settings';

export const dynamic = 'force-dynamic';

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
  // Settings take priority over env so the packaged app needs no .env.
  const PROVIDER = (getSetting('llm_provider') ?? process.env.LLM_PROVIDER ?? 'ollama') as 'ollama' | 'anthropic';
  const hasAnthropicKeySetting = Boolean(getSetting('anthropic_api_key'));
  const hasAnthropicKeyEnv = Boolean(process.env.ANTHROPIC_API_KEY);
  const hasAnthropicKey = hasAnthropicKeySetting || hasAnthropicKeyEnv;

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

  async function switchAndSave(data: FormData) {
    'use server';
    await saveLLMConfig(data);
    redirect('/setup/llm');
  }

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <p className="eyebrow">Step 1</p>
        <h2 className="text-2xl font-semibold tracking-tight">LLM provider</h2>
      </div>

      {/* Provider toggle */}
      <div className="space-y-2">
        <p className="text-sm font-medium text-ink-1">Choose provider</p>
        <div className="flex flex-wrap gap-2">
          <form action={switchAndSave} className="contents">
            <input type="hidden" name="provider" value="ollama" />
            <button
              type="submit"
              className={PROVIDER === 'ollama' ? 'btn-primary' : 'btn'}
              title="Run drafts locally with Ollama"
            >
              Ollama (local)
            </button>
          </form>
          <form action={switchAndSave} className="contents">
            <input type="hidden" name="provider" value="anthropic" />
            <button
              type="submit"
              className={PROVIDER === 'anthropic' ? 'btn-primary' : 'btn'}
              title="Call the Anthropic API for drafts"
            >
              Anthropic API
            </button>
          </form>
        </div>
      </div>

      {/* Ollama instructions */}
      {PROVIDER === 'ollama' && (
        <div className="space-y-3">
          <p className="text-sm text-ink-2">
            Drafts, classification, and follow-ups run on a local Ollama model. Nothing leaves your machine.
          </p>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-2">
            <li>Install: <code className="rounded-sm bg-surface-2 px-1">brew install --cask ollama-app</code></li>
            <li>Start: <code className="rounded-sm bg-surface-2 px-1">open -a Ollama</code></li>
            <li>Pull model: <code className="rounded-sm bg-surface-2 px-1">ollama pull {OLLAMA_MODEL}</code></li>
          </ol>
          <div className="card p-5 text-xs text-ink-2">
            <p>Base URL: <code>{OLLAMA_BASE_URL}</code></p>
            <p>Model: <code>{OLLAMA_MODEL}</code></p>
            <p className="mt-2">
              {ollamaProbe?.ok ? (
                (ollamaProbe as { hasModel: boolean }).hasModel ? (
                  <span className="text-emerald-700">&#10003; Ollama reachable and model is pulled.</span>
                ) : (
                  <span className="text-amber-700">! Reachable but model not pulled. Run <code>ollama pull {OLLAMA_MODEL}</code>.</span>
                )
              ) : (
                <span className="text-red-700">&#10007; Cannot reach Ollama ({(ollamaProbe as { error: string }).error}).</span>
              )}
            </p>
            {ollamaProbe?.ok && (ollamaProbe as { models: string[] }).models.length > 0 && (
              <p className="mt-1 text-ink-3">Installed: {(ollamaProbe as { models: string[] }).models.join(', ')}</p>
            )}
          </div>
        </div>
      )}

      {/* Anthropic section */}
      {PROVIDER === 'anthropic' && (
        <div className="space-y-4">
          <p className="text-sm text-ink-2">
            Drafts, classification, and follow-ups call the Anthropic API. Lower latency and higher quality than local models, but contact data is sent to Claude.
          </p>
          <p className="text-xs text-ink-3">Model: <code>{ANTHROPIC_MODEL}</code></p>

          {hasAnthropicKey ? (
            <>
              <p className="rounded-card bg-emerald-50 p-4 text-sm text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                &#10003; API key saved{hasAnthropicKeySetting ? '' : ' (from environment)'}.
              </p>
              <details className="text-sm">
                <summary className="cursor-pointer text-ink-3 hover:text-ink-2">Update API key</summary>
                <form action={switchAndSave} className="mt-3 space-y-3">
                  <input type="hidden" name="provider" value="anthropic" />
                  <input
                    name="anthropic_api_key"
                    type="password"
                    placeholder="sk-ant-..."
                    className="field w-full"
                    autoComplete="off"
                  />
                  <button type="submit" className="btn">Save new key</button>
                </form>
              </details>
            </>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-ink-2">
                Get a key at{' '}
                <a
                  className="font-medium text-accent hover:text-accent-hover"
                  href="https://console.anthropic.com/settings/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  console.anthropic.com
                </a>
                {' '}then paste it below.
              </p>
              <form action={switchAndSave} className="space-y-3">
                <input type="hidden" name="provider" value="anthropic" />
                <div>
                  <label className="mb-1 block text-sm font-medium text-ink-1" htmlFor="anthropic_api_key">
                    API key
                  </label>
                  <input
                    id="anthropic_api_key"
                    name="anthropic_api_key"
                    type="password"
                    placeholder="sk-ant-..."
                    className="field w-full"
                    autoComplete="off"
                  />
                </div>
                <button type="submit" className="btn-primary">Save key</button>
              </form>
            </div>
          )}
        </div>
      )}

      <form action={confirm}>
        <button
          type="submit"
          disabled={!ready}
          className="btn-primary disabled:opacity-50"
        >
          Confirm
        </button>
      </form>
    </section>
  );
}
