import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@event-drafter/core', '@event-drafter/worker'],
  experimental: {
    serverActions: { bodySizeLimit: '2mb' },
  },
};

export default config;
