const withPWA = require('next-pwa')({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  register: true,
  skipWaiting: true,
    publicExcludes: ['!robots.txt'],
  buildExcludes: [/middleware-manifest\.json$/],
})

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Lint runs in CI (npm run lint); the Docker build must not depend on it.
  eslint: { ignoreDuringBuilds: true },
  // The app never uses next/image. Disabling the optimizer makes /_next/image return 404
  // before any processing (Next 14.1 RCE advisories GHSA-2xp9-vwfh-vxw4, GHSA-2464-fhr4-w9xw).
  images: { unoptimized: true },
  experimental: { serverComponentsExternalPackages: ['yahoo-finance2'] },
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      '@std/testing/mock': false,
      '@std/testing/bdd': false,
      '@gadicc/fetch-mock-cache/runtimes/deno.ts': false,
      '@gadicc/fetch-mock-cache/stores/fs.ts': false,
    };
    return config;
  },
}

module.exports = withPWA(nextConfig)
