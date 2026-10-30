import { describe, it, expect, vi } from 'vitest'
import { fetchUsdRates, seriesToUsd } from '../fx'
import type { Series } from '../types'

const neverCalled = () => vi.fn(async () => { throw new Error('rate source not expected') })

describe('fetchUsdRates', () => {
  it('needs no rates for USD statements', async () => {
    const getCcl = neverCalled()
    const getBars = neverCalled()

    expect(await fetchUsdRates('USD', '2021-12-31', { getCcl, getBars })).toBeNull()
    expect(getCcl).not.toHaveBeenCalled()
    expect(getBars).not.toHaveBeenCalled()
  })

  it("reads ARS from the app's CCL history, starting early enough for a period that ends on a weekend", async () => {
    const ccl = new Map([['2023-12-29', 1000]])
    const getCcl = vi.fn(async () => ccl)
    const getBars = neverCalled()

    const rates = await fetchUsdRates('ARS', '2023-12-31', { getCcl, getBars })

    expect(rates).toBe(ccl)
    expect(getCcl).toHaveBeenCalledTimes(1)
    expect((getCcl.mock.calls[0] as unknown as [Date])[0].toISOString().slice(0, 10)).toBe('2023-12-21')
    expect(getBars).not.toHaveBeenCalled()
  })

  it("reads any other currency from Yahoo's XXX=X daily closes (units per dollar)", async () => {
    const getCcl = neverCalled()
    const getBars = vi.fn(async () => [{ date: '2025-12-31', close: 31.2436 }, { date: '2026-01-02', close: 31.3035 }])

    const rates = await fetchUsdRates('TWD', '2025-12-31', { getCcl, getBars })

    expect(rates).toEqual(new Map([['2025-12-31', 31.2436], ['2026-01-02', 31.3035]]))
    const [symbol, from] = getBars.mock.calls[0] as unknown as [string, Date, Date]
    expect(symbol).toBe('TWD=X')
    expect(from.toISOString().slice(0, 10)).toBe('2025-12-21')
    expect(getCcl).not.toHaveBeenCalled()
  })
})

describe('seriesToUsd', () => {
  it('leaves USD series as they are', () => {
    const series: Series = [{ end: '2025-12-31', value: 28893e6 }]

    expect(seriesToUsd(series, null)).toEqual({ series, degraded: false })
  })

  it('divides each point by the rate on or before its period end, losses included', () => {
    const rates = new Map([['2023-12-29', 1000], ['2024-12-31', 1200], ['2025-01-02', 9999]])
    const series: Series = [
      { end: '2023-12-31', value: 2_000_000 }, // a Sunday: Friday's rate
      { end: '2024-12-31', value: -600_000 },
    ]

    expect(seriesToUsd(series, rates)).toEqual({
      series: [{ end: '2023-12-31', value: 2000 }, { end: '2024-12-31', value: -500 }],
      degraded: false,
    })
  })

  it('drops a point with no rate on or before it and flags the series degraded, never inventing a rate', () => {
    const rates = new Map([['2024-12-31', 31]])
    const series: Series = [{ end: '2023-12-31', value: 310 }, { end: '2024-12-31', value: 620 }]

    expect(seriesToUsd(series, rates)).toEqual({ series: [{ end: '2024-12-31', value: 20 }], degraded: true })
  })
})
