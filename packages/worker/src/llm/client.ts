import { getSetting, setSetting } from '@event-drafter/core/settings';

export const LLM_PROVIDER = (process.env.LLM_PROVIDER ?? 'ollama') as 'ollama' | 'anthropic';

export const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:7b-instruct';
export const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';

export const MODEL = LLM_PROVIDER === 'anthropic' ? ANTHROPIC_MODEL : OLLAMA_MODEL;

export class LLMNotReachable extends Error {
  constructor(detail: string) {
    super(`Ollama not reachable at ${OLLAMA_BASE_URL}: ${detail}. Is \`ollama serve\` running?`);
  }
}

export class LLMModelMissing extends Error {
  constructor(model: string) {
    super(`Ollama model "${model}" not pulled. Run: ollama pull ${model}`);
  }
}

export class AnthropicNotConfigured extends Error {
  constructor() {
    super('No Anthropic API key - set it in Setup (LLM provider page)');
  }
}

export interface CompletionResult {
  text: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export interface PromptBlock {
  system: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }>;
  user: string;
}

export interface CompleteOptions {
  /** Force strict JSON output. Ollama uses `format: "json"`; Anthropic relies on prompt discipline. */
  json?: boolean;
}

interface OllamaChatResponse {
  message?: { role: string; content: string };
  prompt_eval_count?: number;
  eval_count?: number;
  done?: boolean;
  error?: string;
}

async function completeOllama(
  prompt: PromptBlock,
  max_tokens: number,
  opts: CompleteOptions,
): Promise<CompletionResult> {
  const systemText = prompt.system.map((b) => b.text).join('\n\n');
  const body = {
    model: OLLAMA_MODEL,
    stream: false,
    messages: [
      { role: 'system', content: systemText },
      { role: 'user', content: prompt.user },
    ],
    options: { num_predict: max_tokens },
    ...(opts.json ? { format: 'json' as const } : {}),
  };

  let res: Response;
  try {
    res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const wrapped = new LLMNotReachable(detail);
    setSetting('llm_last_error', { ts: Date.now(), message: wrapped.message });
    throw wrapped;
  }

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 404 && /model.*not found/i.test(text)) {
      const wrapped = new LLMModelMissing(OLLAMA_MODEL);
      setSetting('llm_last_error', { ts: Date.now(), message: wrapped.message });
      throw wrapped;
    }
    const message = `Ollama ${res.status}: ${text.slice(0, 200)}`;
    setSetting('llm_last_error', { ts: Date.now(), message });
    throw new Error(message);
  }

  const data = (await res.json()) as OllamaChatResponse;
  if (data.error) {
    setSetting('llm_last_error', { ts: Date.now(), message: data.error });
    throw new Error(`Ollama error: ${data.error}`);
  }

  setSetting('llm_last_ok', { ts: Date.now() });
  return {
    text: data.message?.content ?? '',
    input_tokens: data.prompt_eval_count ?? 0,
    output_tokens: data.eval_count ?? 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
}

let _anthropicClientKey: string | null = null;
let _anthropicClient: import('@anthropic-ai/sdk').default | null = null;

async function getAnthropicClient() {
  const key = getSetting('anthropic_api_key') ?? process.env.ANTHROPIC_API_KEY;
  if (!key) throw new AnthropicNotConfigured();
  // Re-create client if the key changed (e.g. updated in Setup).
  if (_anthropicClient && _anthropicClientKey === key) return _anthropicClient;
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  _anthropicClient = new Anthropic({ apiKey: key });
  _anthropicClientKey = key;
  return _anthropicClient;
}

async function completeAnthropic(
  prompt: PromptBlock,
  max_tokens: number,
  _opts: CompleteOptions,
): Promise<CompletionResult> {
  try {
    const client = await getAnthropicClient();
    const res = await client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens,
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }],
    });
    const text = res.content
      .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('');
    setSetting('llm_last_ok', { ts: Date.now() });
    return {
      text,
      input_tokens: res.usage.input_tokens,
      output_tokens: res.usage.output_tokens,
      cache_creation_input_tokens: res.usage.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: res.usage.cache_read_input_tokens ?? 0,
    };
  } catch (err) {
    setSetting('llm_last_error', {
      ts: Date.now(),
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/** Effective provider: settings first, then env, then default. */
function effectiveLLMProvider(): 'ollama' | 'anthropic' {
  return getSetting('llm_provider') ?? LLM_PROVIDER;
}

export async function complete(
  prompt: PromptBlock,
  max_tokens = 1024,
  opts: CompleteOptions = {},
): Promise<CompletionResult> {
  if (effectiveLLMProvider() === 'anthropic') return completeAnthropic(prompt, max_tokens, opts);
  return completeOllama(prompt, max_tokens, opts);
}
