import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@event-drafter/core', '@event-drafter/worker'],
  // Native/node-only modules pulled in by instrumentation.ts (the worker boot
  // path) must not be bundled — keep them external so `require('fs')`/native
  // .node bindings resolve at runtime. Turbopack does this automatically; the
  // webpack bundler needs it spelled out. On Windows, Turbopack's PostCSS worker
  // crashes (0xc0000142 spawning the loader subprocess), so dev there runs the
  // `dev:webpack` script (next dev --webpack); this block only affects that path.
  serverExternalPackages: ['better-sqlite3'],
  experimental: {
    serverActions: { bodySizeLimit: '2mb' },
  },
  // Windows dev runs with `--webpack` because Turbopack's PostCSS worker crashes
  // on this platform. Webpack, unlike Turbopack, compiles instrumentation.ts's
  // worker-boot dynamic import (-> core/db -> better-sqlite3, and
  // node:child_process) for *every* runtime, even though the NEXT_RUNTIME guard
  // means it only ever executes under nodejs. So:
  //   - nodejs build: externalize the native module so it's require()'d at
  //     runtime instead of bundled (fixes better-sqlite3 reached *through* the
  //     @event-drafter/core transpilePackages entry, which serverExternalPackages
  //     alone doesn't catch);
  //   - edge/client builds: keep the whole node-only subtree out of the bundle
  //     entirely — it's dead code there, so `commonjs` externals never execute.
  webpack: (
    webpackConfig: any,
    { nextRuntime, webpack }: { nextRuntime?: string; webpack: any },
  ) => {
    webpackConfig.externals = webpackConfig.externals || [];
    if (nextRuntime === 'nodejs') {
      webpackConfig.externals.push({
        'better-sqlite3': 'commonjs better-sqlite3',
        bindings: 'commonjs bindings',
      });
    } else {
      // nextRuntime === 'edge' or undefined (client). A client component
      // (WorkerStatus, in the root layout) imports the 'use server'
      // worker-control-actions module, which top-level-imports the node-only
      // worker supervisor. Turbopack strips that server module from the client
      // bundle; webpack pulls its imports in. The code never runs here, so:
      //   1. rewrite `node:*` specifiers to bare so webpack stops throwing
      //      UnhandledSchemeError before externals are even consulted, then
      //   2. externalize the whole node-only subtree as (never-run) requires.
      webpackConfig.plugins = webpackConfig.plugins || [];
      webpackConfig.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^node:/, (res: any) => {
          res.request = res.request.replace(/^node:/, '');
        }),
      );
      // Node builtins: after the rewrite above they're bare specifiers; resolve
      // them to empty modules (they're never executed in this build).
      webpackConfig.resolve = webpackConfig.resolve || {};
      webpackConfig.resolve.fallback = {
        ...(webpackConfig.resolve.fallback || {}),
        fs: false,
        path: false,
        child_process: false,
      };
      // Native npm packages reached through the same dead path: externalize as
      // (never-run) requires so webpack doesn't try to bundle their .node/JS.
      const nodeOnly = new Set(['better-sqlite3', 'bindings', 'file-uri-to-path']);
      const existing = Array.isArray(webpackConfig.externals)
        ? webpackConfig.externals
        : [webpackConfig.externals];
      webpackConfig.externals = [
        ...existing,
        ({ request }: { request?: string }, cb: (e?: null, r?: string) => void) =>
          request && nodeOnly.has(request) ? cb(null, 'commonjs ' + request) : cb(),
      ];
    }
    return webpackConfig;
  },
};

export default config;
