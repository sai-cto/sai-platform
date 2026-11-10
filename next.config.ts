import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Every console page depends on who is logged in, so pages render on each
  // request. Cache Components is deliberately left off (see docs/DECISIONS.md).
  poweredByHeader: false,
  // The floating Next.js badge covers the sidebar's user menu in development.
  devIndicators: false,
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
