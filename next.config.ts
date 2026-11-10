import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Every console page depends on who is logged in, so pages render on each
  // request. Cache Components is deliberately left off (see docs/DECISIONS.md).
  poweredByHeader: false,
  // The floating Next.js badge covers the sidebar's user menu in development.
  devIndicators: false,
  experimental: {
    // CSV imports are uploaded through a server action. The default cap is 1 MB; files may
    // be up to 10 MB (MAX_FILE_BYTES), plus a little room for the form's own overhead.
    serverActions: { bodySizeLimit: '11mb' },
  },
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
