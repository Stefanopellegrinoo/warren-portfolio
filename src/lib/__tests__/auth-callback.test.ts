// T7 (odd/tasks/security-hardening.md S7): the OAuth callback redirects only to a
// same-origin path, and the authorization code never reaches the logs.
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseCallbackParams, validateAuthCode, exchangeCodeForSession } from '@/lib/auth-utils'

const ORIGIN = 'https://warren.example.com'
const nextFor = (raw: string) =>
  parseCallbackParams(`${ORIGIN}/auth/callback?code=abc&next=${encodeURIComponent(raw)}`).next

afterEach(() => vi.restoreAllMocks())

describe('parseCallbackParams: next', () => {
  it.each([
    ['/\\evil.com'],
    ['/\t/evil.com'],
    ['//evil.com'],
    ['https://evil.com/dashboard'],
    ['javascript:alert(1)'],
  ])('falls back to /dashboard for an off-site target %j', (raw) => {
    expect(nextFor(raw)).toBe('/dashboard')
  })

  it('keeps a same-origin path with its query', () => {
    expect(nextFor('/history?range=1y')).toBe('/history?range=1y')
  })

  it('defaults to /dashboard when next is missing', () => {
    expect(parseCallbackParams(`${ORIGIN}/auth/callback?code=abc`).next).toBe('/dashboard')
  })
})

describe('authorization code is never logged', () => {
  const code = 'SECRETCODE-0123456789-abcdefghij'

  it('validateAuthCode error metadata carries no part of the code', () => {
    const bad = 'x'.repeat(600)
    const { error } = validateAuthCode(bad)
    expect(JSON.stringify(error?.metadata)).not.toContain('xxxxxxxxxx')
  })

  it('exchangeCodeForSession logs no part of the code when Supabase rejects it', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const supabase = { auth: { exchangeCodeForSession: async () => ({ error: { message: 'bad', status: 400 } }) } }

    await exchangeCodeForSession(supabase as unknown as SupabaseClient, code)

    expect(JSON.stringify(log.mock.calls)).not.toContain('SECRETCODE')
  })

  it('exchangeCodeForSession logs no part of the code when the exchange throws', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const supabase = { auth: { exchangeCodeForSession: async () => { throw new Error('network down') } } }

    await exchangeCodeForSession(supabase as unknown as SupabaseClient, code)

    expect(JSON.stringify(log.mock.calls)).not.toContain('SECRETCODE')
  })
})
