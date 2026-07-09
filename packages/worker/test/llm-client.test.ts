import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@event-drafter/core/migrate';
import { closeDb } from '@event-drafter/core/db';
import { setSetting, getSetting } from '@event-drafter/core/settings';

// Mock the Anthropic SDK: messages.create throws an APIError-shaped object
// carrying the HTTP status, exactly as the real SDK does on a bad key.
const create = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: (...a: unknown[]) => create(...a) };
  },
}));

import { complete, AnthropicKeyRejected } from '../src/llm/client.js';

let tmp: string;
const prompt = { system: [{ type: 'text' as const, text: 'sys' }], user: 'hi' };

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'vip-llm-test-'));
  process.env.ED_DB_PATH = join(tmp, 'app.db');
  runMigrations();
  setSetting('llm_provider', 'anthropic');
  setSetting('anthropic_api_key', 'sk-ant-fake-key');
  create.mockReset();
});

afterEach(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

describe('completeAnthropic — error mapping', () => {
  it('maps a 401 to a clear "key rejected" error, not a bare 401', async () => {
    const apiErr = Object.assign(new Error('401 authentication_error'), { status: 401 });
    create.mockRejectedValue(apiErr);

    await expect(complete(prompt)).rejects.toBeInstanceOf(AnthropicKeyRejected);
    // The operator-facing last error is the friendly message, not the raw 401.
    const last = getSetting('llm_last_error') as { message?: string } | undefined;
    expect(last?.message).toMatch(/rejected the API key/i);
    expect(last?.message).toMatch(/Setup/);
  });

  it('passes through non-401 errors unchanged', async () => {
    const apiErr = Object.assign(new Error('overloaded'), { status: 529 });
    create.mockRejectedValue(apiErr);

    await expect(complete(prompt)).rejects.toThrow(/overloaded/);
  });
});
