import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@vip/core', '@vip/worker'],
  experimental: {
    serverActions: { bodySizeLimit: '2mb' },
  },
};

export default config;
