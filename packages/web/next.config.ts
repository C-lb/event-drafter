import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@event-drafter/core', '@event-drafter/worker'],
  // better-sqlite3 is a native addon. Under Next 16 / Turbopack it otherwise
  // gets externalized under a content-hashed alias that has no real module
  // behind it, so the packaged app 500s on every DB-touching route
  // ("Cannot find module 'better-sqlite3-<hash>'"). Marking it server-external
  // makes Next require it by its real name from node_modules at runtime.
  serverExternalPackages: ['better-sqlite3'],
  experimental: {
    serverActions: { bodySizeLimit: '2mb' },
  },
};

export default config;
