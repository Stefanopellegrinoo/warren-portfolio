import { describe, it, expect } from 'vitest'
import { ledgerAt, type LedgerTrade } from '../ledger-core'

let seq = 0
const tx = (ticker: string, operation: string, quantity: number, price: number, date: string, extra: Partial<LedgerTrade> = {}): LedgerTrade => ({
  ticker, operation, quantity, price, commission: 0, date, asset_type: 'CEDEAR',
  created_at: `${date}T12:00:${String(seq++ % 60).padStart(2, '0')}Z`, ...extra,
})

describe('ledgerAt: holdings and running average cost', () => {
  it('buys average in with commission; a sale keeps the average and reduces the cost', () => {
    const s = ledgerAt([
      tx('AAPL', 'COMPRA', 10, 100, '2026-01-02', { commission: 5 }),
      tx('AAPL', 'COMPRA', 10, 110, '2026-01-03'),
      tx('AAPL', 'VENTA', -5, 120, '2026-01-04', { commission: 1 }),
    ], [], '2026-01-31')
    expect(s.holdings).toEqual([{ ticker: 'AAPL', assetType: 'STOCK', quantity: 15, avgCost: 105.25, costBasis: 1578.75, firstBought: '2026-01-02' }])
    expect(s.realized).toEqual([{ ticker: 'AAPL', assetType: 'STOCK', date: '2026-01-04', quantity: 5, invested: 526.25, proceeds: 599, pnl: 72.75 }])
  })

  it('only counts operations on or before the date', () => {
    const s = ledgerAt([tx('AAPL', 'COMPRA', 1, 100, '2026-01-02'), tx('AAPL', 'COMPRA', 1, 100, '2026-02-02')], [], '2026-01-31')
    expect(s.holdings[0].quantity).toBe(1)
  })

  it('a full close drops the holding, and a later buy starts a new first-bought date and cost', () => {
    const s = ledgerAt([
      tx('KO', 'COMPRA', 2, 50, '2026-01-02'),
      tx('KO', 'VENTA', -2, 60, '2026-01-05'),
      tx('KO', 'COMPRA', 1, 70, '2026-03-01'),
    ], [], '2026-03-31')
    expect(s.holdings).toEqual([{ ticker: 'KO', assetType: 'STOCK', quantity: 1, avgCost: 70, costBasis: 70, firstBought: '2026-03-01' }])
  })

  it('same day without insertion order: the buy goes first, never a phantom open position', () => {
    const s = ledgerAt([
      tx('KO', 'VENTA', -2, 60, '2026-01-02', { created_at: null }),
      tx('KO', 'COMPRA', 2, 50, '2026-01-02', { created_at: null }),
    ], [], '2026-01-31')
    expect(s.holdings).toEqual([])
    expect(s.realized[0].pnl).toBe(20)
  })

  it('selling more than held: sells what was held and reports the issue, never silently', () => {
    const s = ledgerAt([tx('KO', 'COMPRA', 1, 50, '2026-01-02'), tx('KO', 'VENTA', -3, 60, '2026-01-03')], [], '2026-01-31')
    expect(s.holdings).toEqual([])
    expect(s.realized[0]).toMatchObject({ quantity: 1, invested: 50, proceeds: 60 })
    expect(s.issues).toEqual([{ kind: 'oversell', ticker: 'KO', date: '2026-01-03', requested: 3, held: 1 }])
  })

  it('routes by asset type, not by a D suffix, and keys tickers case-insensitively', () => {
    const s = ledgerAt([
      tx('AMD', 'COMPRA', 1, 10, '2026-01-02', { asset_type: 'ACCION' }),
      tx('ym42d', 'COMPRA', 2, 100, '2026-01-02', { asset_type: 'ON' }),
      tx('YM42D', 'COMPRA', 2, 102, '2026-01-03', { asset_type: 'ON' }),
    ], [], '2026-01-31')
    expect(s.holdings.map(h => [h.ticker, h.assetType, h.quantity])).toEqual([['AMD', 'STOCK', 1], ['YM42D', 'ON', 4]])
  })

  it('income rows (CUPON, DIVIDENDO) do not change holdings', () => {
    const s = ledgerAt([tx('KO', 'COMPRA', 1, 50, '2026-01-02'), tx('KO', 'DIVIDENDO', 3, 1, '2026-01-03')], [], '2026-01-31')
    expect(s.holdings[0]).toMatchObject({ quantity: 1, costBasis: 50 })
  })
})

describe('ledgerAt: cash', () => {
  it('sums signed movements up to the date', () => {
    const s = ledgerAt([], [
      { type: 'DEPOSITO', amount: 1000, date: '2026-01-02' },
      { type: 'COMPRA', amount: 300, date: '2026-01-03' },
      { type: 'CUPON', amount: 5, date: '2026-01-04' },
      { type: 'RETIRO', amount: 100, date: '2026-02-01' },
    ], '2026-01-31')
    expect(s.cash).toBe(705)
  })
})
