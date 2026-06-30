import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      // server-only is not installed as a standalone package; stub it for tests
      'server-only': resolve(__dirname, 'lib/__mocks__/server-only.ts'),
      // @/ path alias mirrors tsconfig paths: { "@/*": ["./*"] }
      '@': resolve(__dirname),
    },
  },
  test: {
    environment: 'node',
    include: ['app/**/*.test.ts', 'lib/**/*.test.ts'],
  },
});
