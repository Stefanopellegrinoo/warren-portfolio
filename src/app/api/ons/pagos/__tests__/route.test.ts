import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

const mockRequireUser = vi.fn()
vi.mock('@/lib/api-auth', () => ({ requireUser: () => mockRequireUser(), isAuthFailure: (r: any) => 'error' in r }))
const mockLoad = vi.fn()
vi.mock('@/lib/on-payments', () => ({ loadPayments: (...a: unknown[]) => mockLoad(...a) }))
const mockInvalidate = vi.fn()
vi.mock('@/lib/redis', () => ({ invalidateUserCache: (...a: unknown[]) => mockInvalidate(...a) }))

const { GET, PUT, DELETE } = await import('../route')

/** A fake user client: `held` = the ON tickers the user has transactions for; records every write. */
function fakeSupabase(held: string[], deleted = 1) {
  const writes: { op: string; table: string; payload?: unknown; filters: Record<string, unknown>; onConflict?: string }[] = []
  const from = (table: string) => {
    const filters: Record<string, unknown> = {}
    let op = 'select'
    let payload: unknown
    let onConflict: string | undefined
    const q: any = {
      select: () => q,
      eq: (c: string, v: unknown) => { filters[c] = v; return q },
      limit: () => q,
      upsert: (p: unknown, o: { onConflict: string }) => { op = 'upsert'; payload = p; onConflict = o.onConflict; return q },
      delete: () => { op = 'delete'; return q },
      then: (resolve: (r: unknown) => void) => {
        if (op !== 'select') writes.push({ op, table, payload, filters: { ...filters }, onConflict })
        if (table === 'transactions') return resolve({ data: held.includes(String(filters.ticker)) ? [{ id: 1 }] : [], error: null })
        if (op === 'delete') return resolve({ data: Array.from({ length: deleted }, () => ({ id: 'x' })), error: null })
        return resolve({ data: [{ id: 'x' }], error: null })
      },
    }
    return q
  }
  return { client: { from }, writes }
}

const put = (body: unknown) => new Request('http://x/api/ons/pagos', { method: 'PUT', body: JSON.stringify(body) })
const del = (qs: string) => new Request(`http://x/api/ons/pagos?${qs}`, { method: 'DELETE' })
const UNAUTH = { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

beforeEach(() => { mockRequireUser.mockReset(); mockLoad.mockReset(); mockInvalidate.mockReset() })

describe('/api/ons/pagos', () => {
  it('every method requires a session', async () => {
    mockRequireUser.mockResolvedValue(UNAUTH)
    expect((await GET()).status).toBe(401)
    expect((await PUT(put({}))).status).toBe(401)
    expect((await DELETE(del(''))).status).toBe(401)
    expect(mockLoad).not.toHaveBeenCalled()
  })

  it('GET returns the payments and the missing ones for the session user', async () => {
    const { client } = fakeSupabase([])
    mockRequireUser.mockResolvedValue({ supabase: client, user: { id: 'u1' } })
    mockLoad.mockResolvedValue({ payments: [{ ticker: 'VSCXD' }], missing: [] })
    const res = await GET()
    expect(res.status).toBe(200)
    expect(mockLoad).toHaveBeenCalledWith(client, 'u1', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/))
    expect(await res.json()).toEqual({ payments: [{ ticker: 'VSCXD' }], missing: [] })
  })

  it('GET failure is a generic 500', async () => {
    mockRequireUser.mockResolvedValue({ supabase: fakeSupabase([]).client, user: { id: 'u1' } })
    mockLoad.mockRejectedValue(new Error('password=xyz'))
    const res = await GET()
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('xyz')
  })

  it('PUT upserts the broker amount for one payment and invalidates the caches', async () => {
    const { client, writes } = fakeSupabase(['VSCXD'])
    mockRequireUser.mockResolvedValue({ supabase: client, user: { id: 'u1' } })
    const res = await PUT(put({ ticker: 'vscxd', pay_date: '2026-10-09', kind: 'coupon', amount: 1140.5, note: 'Neto de gastos' }))
    expect(res.status).toBe(200)
    expect(writes).toEqual([{
      op: 'upsert', table: 'on_payment_overrides', filters: {}, onConflict: 'user_id,ticker,pay_date,kind',
      payload: expect.objectContaining({ user_id: 'u1', ticker: 'VSCXD', pay_date: '2026-10-09', kind: 'coupon', amount: 1140.5, note: 'Neto de gastos' }),
    }])
    expect(mockInvalidate).toHaveBeenCalledWith('u1')
  })

  it('PUT with amount null records "No lo cobré"', async () => {
    const { client, writes } = fakeSupabase(['VSCXD'])
    mockRequireUser.mockResolvedValue({ supabase: client, user: { id: 'u1' } })
    expect((await PUT(put({ ticker: 'VSCXD', pay_date: '2026-10-09', kind: 'coupon', amount: null }))).status).toBe(200)
    expect(writes[0].payload).toMatchObject({ amount: null, note: null })
  })

  it('PUT validates the body', async () => {
    const { client, writes } = fakeSupabase(['VSCXD'])
    mockRequireUser.mockResolvedValue({ supabase: client, user: { id: 'u1' } })
    for (const bad of [
      { ticker: 'VSCXD', pay_date: '2026-10-09', kind: 'coupon', amount: 0 },
      { ticker: 'VSCXD', pay_date: '2026-10-09', kind: 'coupon', amount: -5 },
      { ticker: 'VSCXD', pay_date: '09/10/2026', kind: 'coupon', amount: 10 },
      { ticker: 'VSCXD', pay_date: '2026-10-09', kind: 'dividend', amount: 10 },
      { ticker: 'VS CX', pay_date: '2026-10-09', kind: 'coupon', amount: 10 },
      { ticker: 'VSCXD', pay_date: '2026-10-09', kind: 'coupon' },
    ]) expect((await PUT(put(bad))).status).toBe(400)
    expect(writes).toEqual([])
    expect(mockInvalidate).not.toHaveBeenCalled()
  })

  it('PUT rejects a ticker the user never held', async () => {
    const { client, writes } = fakeSupabase(['VSCXD'])
    mockRequireUser.mockResolvedValue({ supabase: client, user: { id: 'u1' } })
    const res = await PUT(put({ ticker: 'YM42D', pay_date: '2026-10-09', kind: 'coupon', amount: 10 }))
    expect(res.status).toBe(404)
    expect(writes).toEqual([])
  })

  it('DELETE removes the correction (back to automatic) and invalidates the caches', async () => {
    const { client, writes } = fakeSupabase(['VSCXD'])
    mockRequireUser.mockResolvedValue({ supabase: client, user: { id: 'u1' } })
    const res = await DELETE(del('ticker=VSCXD&pay_date=2026-10-09&kind=coupon'))
    expect(res.status).toBe(204)
    expect(writes).toEqual([{ op: 'delete', table: 'on_payment_overrides', payload: undefined, onConflict: undefined,
      filters: { user_id: 'u1', ticker: 'VSCXD', pay_date: '2026-10-09', kind: 'coupon' } }])
    expect(mockInvalidate).toHaveBeenCalledWith('u1')
  })

  it('DELETE of a correction that does not exist is 404; a bad query is 400', async () => {
    mockRequireUser.mockResolvedValue({ supabase: fakeSupabase([], 0).client, user: { id: 'u1' } })
    expect((await DELETE(del('ticker=VSCXD&pay_date=2026-10-09&kind=coupon'))).status).toBe(404)
    expect((await DELETE(del('ticker=VSCXD&kind=coupon'))).status).toBe(400)
    expect(mockInvalidate).not.toHaveBeenCalled()
  })
})
