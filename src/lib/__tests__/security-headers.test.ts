// @vitest-environment node
// T8 (odd/tasks/security-hardening.md S8): security headers on every response and
// no X-Powered-By. headers() is evaluated by `next build`, where NODE_ENV=production.
import { describe, it, expect, beforeAll } from 'vitest'
import { createRequire } from 'node:module'
import { join } from 'node:path'

type Header = { key: string; value: string }
let config: { poweredByHeader?: boolean; headers: () => Promise<{ source: string; headers: Header[] }[]> }
let headers: Record<string, string>

beforeAll(async () => {
  const env = process.env as Record<string, string | undefined>
  const prev = { node: env.NODE_ENV, url: env.NEXT_PUBLIC_SUPABASE_URL }
  env.NODE_ENV = 'production'
  env.NEXT_PUBLIC_SUPABASE_URL = 'https://abcdefghijklmnopqrst.supabase.co'
  try {
    const req = createRequire(import.meta.url)
    // next-pwa needs Next's bundled webpack at load time; it only wraps the config, so stub it as identity.
    const pwa = req.resolve('next-pwa')
    req.cache[pwa] = { id: pwa, filename: pwa, loaded: true, exports: () => (c: unknown) => c } as unknown as NodeJS.Module
    config = req(join(process.cwd(), 'next.config.js'))
    const rules = await config.headers()
    const all = rules.find(r => r.source === '/(.*)')
    headers = Object.fromEntries((all?.headers ?? []).map(h => [h.key, h.value]))
  } finally {
    env.NODE_ENV = prev.node
    env.NEXT_PUBLIC_SUPABASE_URL = prev.url
  }
})

describe('next.config.js security headers', () => {
  it('does not advertise the framework', () => {
    expect(config.poweredByHeader).toBe(false)
  })

  it('forbids framing, MIME sniffing and full referrers, and pins HTTPS', () => {
    expect(headers['X-Frame-Options']).toBe('DENY')
    expect(headers['X-Content-Type-Options']).toBe('nosniff')
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
    expect(headers['Strict-Transport-Security']).toMatch(/^max-age=\d{8,}/)
    expect(headers['Permissions-Policy']).toContain('camera=()')
  })

  it('CSP: no framing, no plugins, no foreign base or form targets', () => {
    const csp = headers['Content-Security-Policy']
    for (const d of ["default-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'"]) {
      expect(csp).toContain(d)
    }
  })

  it('CSP connect-src allows exactly the origins the browser talks to', () => {
    const connect = headers['Content-Security-Policy'].split(';').map(s => s.trim()).find(s => s.startsWith('connect-src'))
    expect(connect?.split(/\s+/).slice(1).sort()).toEqual([
      "'self'",
      'https://abcdefghijklmnopqrst.supabase.co',
      'https://api.binance.com',
      'wss://stream.binance.com:9443',
    ])
  })
})
