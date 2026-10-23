const withPWA = require('next-pwa')({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  register: true,
  skipWaiting: true,
    publicExcludes: ['!robots.txt'],
  buildExcludes: [/middleware-manifest\.json$/],
  // The default 'apis' rule caches GET /api/* (portfolio JSON) on the device for 24 h,
  // where it outlives logout. Without it, /api/* always goes to the network.
  runtimeCaching: require('next-pwa/cache').filter((rule) => rule.options?.cacheName !== 'apis'),
})

// Origins the browser talks to directly: Supabase Auth (login, token refresh) and Binance
// market data (src/lib/binance/rest.ts, ws.ts). Everything else goes through /api.
const supabaseOrigin = (() => {
  try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin } catch { return 'https://*.supabase.co' }
})()

// ponytail: 'unsafe-inline' scripts cover Next's inline bootstrap and the theme script in
// layout.tsx; a per-request nonce from middleware is the upgrade path. connect-src still
// blocks sending data to any other origin.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${supabaseOrigin} https://api.binance.com wss://stream.binance.com:9443`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  // Production only: dev needs eval for React Refresh, and HSTS on localhost sticks.
  async headers() {
    return process.env.NODE_ENV === 'production' ? [{ source: '/(.*)', headers: securityHeaders }] : []
  },
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
