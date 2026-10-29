import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetDerivedSeries = vi.fn()
vi.mock('@/lib/derived-series', () => ({ getDerivedSeries: (...a: unknown[]) => mockGetDerivedSeries(...a) }))
const mockFetchFlowTransactions = vi.fn()
vi.mock('@/lib/flow-transactions', () => ({ fetchFlowTransactions: (...a: unknown[]) => mockFetchFlowTransactions(...a) }))
const mockFetchIncomeMovements = vi.fn()
vi.mock('@/lib/cash-flows', () => ({
  fetchIncomeMovements: (...a: unknown[]) => mockFetchIncomeMovements(...a),
}))

const { loadStocksTwr } = await import('../stocks-twr')

const snap = (snapshot_date: string, stocks_value: number) => ({
  snapshot_date,
  total_value: stocks_value + 100,
  total_invested: 0,
  pnl: 0,
  stocks_value,
  stocks_invested: 500,
  ons_value: 0,
  ons_invested: 0,
  cash_value: 100,
})

beforeEach(() => {
  vi.clearAllMocks()
  mockFetchIncomeMovements.mockResolvedValue([])
  mockFetchFlowTransactions.mockResolvedValue([])
})

describe('loadStocksTwr', () => {
  it('measures the stocks alone: their value going 600 → 660 is +10 %', async () => {
    mockGetDerivedSeries.mockResolvedValue({ rows: [snap('2026-01-02', 600), snap('2026-01-05', 660)], income: [], externalFlows: [] })
    const twr = await loadStocksTwr({} as never, 'u1')
    expect(twr.at(-1)?.twrPct).toBeCloseTo(10)
  })

  it('a stock bought in between is money in, not a gain', async () => {
    mockGetDerivedSeries.mockResolvedValue({ rows: [snap('2026-01-02', 600), snap('2026-01-05', 760)], income: [], externalFlows: [] })
    mockFetchFlowTransactions.mockResolvedValue([
      { date: '2026-01-05', operation: 'COMPRA', quantity: 1, price: 100, commission: 0, asset_type: 'ACCION' },
    ])
    const twr = await loadStocksTwr({} as never, 'u1')
    expect(twr.at(-1)?.twrPct).toBeCloseTo(10)
  })
})
