import { describe, it, expect } from 'vitest';
import { resolveRuntimeEnv } from './runtime';

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
});
