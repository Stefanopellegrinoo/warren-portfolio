// odd/tasks/ux-paginas.md S4: an expense due today is not overdue until the day is over in Argentina.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import type { Cashflow } from '@/types'

const rows: Partial<Cashflow>[] = [
  { id: 't', date: '2026-10-24', status: 'PENDIENTE', amount_usd: 10 },
  { id: 'y', date: '2026-10-23', status: 'PENDIENTE', amount_usd: 20 },
  { id: 'p', date: '2026-10-01', status: 'PAGADO', amount_usd: 40 },
]
const updated = { id: 't', user_id: 'u', date: '2026-10-24', category: 'Salud', status: 'PAGADO', amount_usd: 10 }
const order = vi.fn(async () => ({ data: rows, error: null as unknown, count: rows.length }))
const single = vi.fn(async () => ({ data: updated, error: null }))
const removed = vi.fn(async () => ({ error: null }))
const supabase = {
  from: () => ({
    select: () => ({ eq: () => ({ order }) }),
    update: () => ({ eq: () => ({ eq: () => ({ select: () => ({ single }) }) }) }),
    delete: () => ({ eq: () => ({ eq: removed }) }),
  }),
}

vi.mock('@/lib/api-auth', () => ({
  requireUser: async () => ({ supabase, user: { id: 'u' } }),
  isAuthFailure: () => false,
}))
vi.mock('@/lib/redis', () => ({ invalidateUserCache: vi.fn() }))

afterEach(() => { vi.useRealTimers(); order.mockClear() })

// 23:30 in Buenos Aires is already the 25th in UTC.
const lateNight = () => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-24T23:30:00-03:00')) }
const send = (method: string, body: object) => new NextRequest('http://localhost/api/cashflow', { method, body: JSON.stringify(body) })
const LIST = { data: rows, count: 3, totalPending: 30, overdueCount: 1 }

describe('GET /api/cashflow', () => {
  it('counts as overdue only pending expenses due before today in Argentina', async () => {
    lateNight()
    const { GET } = await import('./route')
    const res = await GET(new NextRequest('http://localhost/api/cashflow'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ count: 3, totalPending: 30, overdueCount: 1 })
  })
})

// odd/tasks/rendimiento.md S7: an edit or delete answers the updated list, so the page needs no second request.
describe('PATCH and DELETE /api/cashflow', () => {
  it('a status change answers the updated expense and the list as GET reads it', async () => {
    lateNight()
    const { PATCH } = await import('./route')
    const res = await PATCH(send('PATCH', { id: 't', status: 'PAGADO' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ...updated, list: LIST })
  })

  it('a delete answers ok and the list as GET reads it', async () => {
    lateNight()
    const { DELETE } = await import('./route')
    const res = await DELETE(send('DELETE', { id: 'p' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, list: LIST })
    expect(removed).toHaveBeenCalledWith('user_id', 'u')
  })

  it('a change that saved still answers success when the list cannot be read', async () => {
    order.mockResolvedValueOnce({ data: null as never, error: { message: 'down' }, count: 0 })
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { PATCH } = await import('./route')
    const res = await PATCH(send('PATCH', { id: 't', status: 'PAGADO' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(updated)
    expect(logged).toHaveBeenCalledTimes(1)
    logged.mockRestore()
  })
})
