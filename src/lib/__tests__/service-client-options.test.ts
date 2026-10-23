// T12 follow-up (odd/tasks/security-hardening.md L17): the service client is created
// per call on most routes. With default auth options supabase-js starts a 30 s
// auto-refresh timer that is never stopped, so every client stayed in memory.
import { describe, it, expect, vi } from 'vitest'

const createClient = vi.fn((..._args: unknown[]) => ({}))
vi.mock('@supabase/supabase-js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@supabase/supabase-js')>()),
  createClient: (...args: unknown[]) => createClient(...args),
}))

import { createServiceClient } from '@/lib/supabase-server'

describe('createServiceClient', () => {
  it('creates a client with no session persistence and no auto-refresh timer', () => {
    createServiceClient()

    expect(createClient).toHaveBeenCalledWith(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      expect.objectContaining({ auth: expect.objectContaining({ persistSession: false, autoRefreshToken: false }) }),
    )
  })
})
