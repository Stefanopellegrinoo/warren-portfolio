// odd/tasks/ux-paginas.md S4: an expense due today is not overdue until the day is over in Argentina.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import type { Cashflow } from '@/types'

const rows: Partial<Cashflow>[] = [
  { id: 't', date: '2026-10-24', status: 'PENDIENTE', amount_usd: 10 },
  { id: 'y', date: '2026-10-23', status: 'PENDIENTE', amount_usd: 20 },
  { id: 'p', date: '2026-10-01', status: 'PAGADO', amount_usd: 40 },
]
const order = vi.fn(async () => ({ data: rows, error: null, count: rows.length }))
const supabase = { from: () => ({ select: () => ({ eq: () => ({ order }) }) }) }

vi.mock('@/lib/api-auth', () => ({
  requireUser: async () => ({ supabase, user: { id: 'u' } }),
  isAuthFailure: () => false,
}))
vi.mock('@/lib/redis', () => ({ invalidateUserCache: vi.fn() }))

afterEach(() => { vi.useRealTimers() })

describe('GET /api/cashflow', () => {
  it('counts as overdue only pending expenses due before today in Argentina', async () => {
    // 23:30 in Buenos Aires is already the 25th in UTC.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-24T23:30:00-03:00'))
    const { GET } = await import('./route')
    const res = await GET(new NextRequest('http://localhost/api/cashflow'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ count: 3, totalPending: 30, overdueCount: 1 })
  })
})
