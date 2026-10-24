const STATIC_CACHES = ['static-font-assets', 'static-image-assets', 'static-js-assets', 'static-style-assets']

const withPWA = require('next-pwa')({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  // next-pwa injects its registration only into the Pages Router entry (main.js), which App Router
  // pages never load: src/components/shell/AppStatus.tsx registers /sw.js instead.
  register: false,
  skipWaiting: true,
  publicExcludes: ['!robots.txt'],
  // app-build-manifest.json is a build file Next never serves: precaching its 404 fails the install.
  buildExcludes: [/middleware-manifest\.json$/, /app-build-manifest\.json$/],
  // No start-url cache: it would store the response of `/`, a redirect that depends on the session.
  cacheStartUrl: false,
  dynamicStartUrl: false,
  // A screen that cannot load without connection gets the Spanish offline page, not the browser's.
  fallbacks: { document: '/offline' },
  // Only what is the same for every user is cached: fonts, images, scripts and styles. Pages, RSC
  // payloads, /api/* and other origins (Supabase Auth, Binance) always go to the network, so nothing
  // personal stays on the device after logout. Navigations get a rule only so `fallbacks` applies.
  runtimeCaching: [
    ...require('next-pwa/cache').filter((rule) => STATIC_CACHES.includes(rule.options?.cacheName)),
    {
      urlPattern: ({ request, url, sameOrigin }) => sameOrigin && request.mode === 'navigate' && !url.pathname.startsWith('/api/'),
      handler: 'NetworkOnly',
      options: {},
    },
  ],
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
