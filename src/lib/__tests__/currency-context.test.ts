import { describe, it, expect, vi, beforeEach } from 'vitest'

const getDollarInfo = vi.fn()
vi.mock('../currency', () => ({ getDollarInfo: (...a: unknown[]) => getDollarInfo(...a) }))

const { loadCurrencyContext } = await import('../currency-views')

const supabase = {
  from: () => ({ select: () => ({ range: async () => ({ data: [{ ticker: 'AAPL', ratio: 20 }], error: null }) }) }),
} as any

beforeEach(() => getDollarInfo.mockReset())

describe('loadCurrencyContext', () => {
  it("values today with the live dollar, dated by the provider's update", async () => {
    getDollarInfo.mockImplementation(async (kind: string) =>
      kind === 'mep'
        ? { rate: 1550.25, asOf: '2026-10-22T20:59:00.000Z', source: 'live' }
        : { rate: 1638.7, asOf: '2026-10-22T20:59:00.000Z', source: 'cache' })
    const ctx = await loadCurrencyContext(supabase)
    expect(ctx?.fx).toEqual({ mep: { rate: 1550.25, date: '2026-10-22' }, ccl: { rate: 1638.7, date: '2026-10-22' } })
    expect(ctx?.ratios.get('AAPL')).toBe(20)
  })

  it('no live or last-known rate: null, so the Resumen keeps the USD figures', async () => {
    getDollarInfo.mockResolvedValue(null)
    expect(await loadCurrencyContext(supabase)).toBeNull()
  })
})
