/**
 * Regression guard: asserts that every runtime-required path has a covering
 * extraResources entry in electron-builder.yml. This test would have caught
 * Critical #1 (core/drizzle missing) and Important #2 (web/package.json missing).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const ymlPath = join(__dirname, '..', 'electron-builder.yml');
const yml = readFileSync(ymlPath, 'utf-8');

describe('electron-builder.yml shipped paths', () => {
  const requiredFromEntries: Array<{ path: string; description: string }> = [
    // core dist - needed for migrate.js and other compiled modules
    { path: '../../packages/core/dist', description: 'core/dist/migrate.js' },
    // core drizzle - needed by drizzle migrator (_journal.json); CRITICAL #1
    { path: '../../packages/core/drizzle', description: 'core/drizzle/meta/_journal.json' },
    // worker dist - forked child entry point
    { path: '../../packages/worker/dist', description: 'worker/dist/index.js' },
    // worker + core are "type": "module"; their package.json must ship so node
    // parses the dist as ESM, else: "Cannot use import statement outside a module"
    { path: '../../packages/worker/package.json', description: 'worker/package.json (ESM type marker)' },
    { path: '../../packages/core/package.json', description: 'core/package.json (ESM type marker)' },
    // node_modules - next binary + all runtime deps
    { path: '../../node_modules', description: 'node_modules/next/dist/bin/next' },
    // web .next build
    { path: '../../packages/web/.next', description: 'web .next build' },
    // web package.json - needed by next start for type/config resolution; IMPORTANT #2
    { path: '../../packages/web/package.json', description: 'web/package.json' },
    // Chromium via Playwright
    { path: 'resources/ms-playwright', description: 'chromium via ms-playwright' },
  ];

  for (const { path, description } of requiredFromEntries) {
    it(`ships ${description}`, () => {
      expect(yml).toContain(`from: ${path}`);
    });
  }

  it('does not ship the nonexistent packages/web/public directory', () => {
    expect(yml).not.toContain('packages/web/public');
  });

  // Regression guard: the packaged app runs entirely on Electron's Node (every
  // child is forked with execPath=electron + ELECTRON_RUN_AS_NODE), so the
  // shipped better-sqlite3 must be Electron-ABI. Plain `electron-builder` does
  // NOT rebuild the hoisted root copy (better-sqlite3 isn't a declared desktop
  // dep), so it silently ships the system-Node-ABI binary and the app crashes
  // at runtime with ERR_DLOPEN_FAILED / NODE_MODULE_VERSION mismatch. The dist
  // script MUST route through scripts/package.mjs, which rebuilds for Electron,
  // packages, then restores the system-Node binary for dev/test.
  it('dist script rebuilds the native binary via scripts/package.mjs', () => {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'),
    );
    expect(pkg.scripts.dist).toContain('scripts/package.mjs');
  });
});
