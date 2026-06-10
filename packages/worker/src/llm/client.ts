import Anthropic from '@anthropic-ai/sdk';

export const MODEL = 'claude-sonnet-4-6';

export class AnthropicNotConfigured extends Error {
  constructor() {
    super('ANTHROPIC_API_KEY missing from .env');
  }
}

let _client: Anthropic | null = null;

export function getClient(): Anthropic {
  if (_client) return _client;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new AnthropicNotConfigured();
  _client = new Anthropic({ apiKey: key });
  return _client;
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

export async function complete(prompt: PromptBlock, max_tokens = 1024): Promise<CompletionResult> {
  const client = getClient();
  const res = await client.messages.create({
    model: MODEL,
    max_tokens,
    system: prompt.system,
    messages: [{ role: 'user', content: prompt.user }],
  });

  const text = res.content
    .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('');

  return {
    text,
    input_tokens: res.usage.input_tokens,
    output_tokens: res.usage.output_tokens,
    cache_creation_input_tokens: res.usage.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: res.usage.cache_read_input_tokens ?? 0,
  };
}
