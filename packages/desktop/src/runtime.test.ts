import { describe, it, expect } from 'vitest';
import { createServer } from 'node:net';
import { resolveRuntimeEnv, pickPreferredPort } from './runtime';

describe('resolveRuntimeEnv', () => {
  it('puts DB + profile under the data dir and sets the port', () => {
    const { env, port } = resolveRuntimeEnv({ userData: '/data', browsersPath: '/b', port: 4123 });
    expect(env.ED_DB_PATH).toBe('/data/app.db');
    expect(env.ED_WA_PROFILE_DIR).toBe('/data/wa-profile');
    expect(env.PLAYWRIGHT_BROWSERS_PATH).toBe('/b');
    expect(env.PORT).toBe('4123');
    expect(env.HOSTNAME).toBe('127.0.0.1');
    expect(port).toBe(4123);
  });

  it('injects GOOGLE_REDIRECT_URI derived from the port', () => {
    const { env } = resolveRuntimeEnv({ userData: '/data', browsersPath: '/b', port: 41000 });
    expect(env.GOOGLE_REDIRECT_URI).toBe('http://127.0.0.1:41000/api/auth/google/callback');
  });
});

describe('pickPreferredPort', () => {
  it('returns the preferred port when it is free', async () => {
    // Use a high ephemeral port unlikely to be in use during tests.
    const port = await pickPreferredPort(49876);
    expect(port).toBe(49876);
  });

  it('falls back to a different free port when the preferred one is busy', async () => {
    // Occupy a port, then ask pickPreferredPort to use it.
    const blocker = createServer();
    await new Promise<void>((res) => blocker.listen(49877, '127.0.0.1', res));
    try {
      const port = await pickPreferredPort(49877);
      expect(port).not.toBe(49877);
      expect(port).toBeGreaterThan(0);
    } finally {
      await new Promise<void>((res) => blocker.close(() => res()));
    }
  });
});
