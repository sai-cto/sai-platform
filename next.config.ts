import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Every console page depends on who is logged in, so pages render on each
  // request. Cache Components is deliberately left off (see docs/DECISIONS.md).
  poweredByHeader: false,
  serverExternalPackages: ['postgres'],
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

export default nextConfig;
