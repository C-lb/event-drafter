import { defineConfig, configDefaults } from 'vitest/config';

// Only run the source tests. Exclude build outputs: `dist/` holds compiled
// copies of the *.test.ts files, and `release/` holds the packaged .app which
// bundles this package's src — globbing either re-runs (or fails to load) those
// stale copies and breaks the test gate after a local build.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '**/dist/**', '**/release/**'],
  },
});
