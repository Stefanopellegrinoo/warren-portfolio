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

describe('ledgerAt: automatic ON payments', () => {
  const on = (op: string, q: number, p: number, date: string) => tx('YM42D', op, op === 'VENTA' ? -q : q, p, date, { asset_type: 'ON' })
  // 2026-06-02 is a Tuesday: the holder at the close of Monday 06-01 is paid.
  const schedules = new Map([['YM42D', [{ date: '2026-06-02', ren: 3.5, amo: 0 }, { date: '2026-12-02', ren: 3.5, amo: 25 }]]])

  it('pays the coupon to the holder at the close of the business day before the payment', () => {
    const s = ledgerAt([on('COMPRA', 200, 100, '2026-04-01')], [], '2026-06-30', { schedules })
    expect(s.cash).toBeCloseTo(700)
    expect(s.income).toEqual([{ ticker: 'YM42D', date: '2026-06-02', kind: 'coupon', amount: 700, source: 'schedule' }])
  })

  it('a buy on the payment day is not paid; a sale on the payment day still is', () => {
    expect(ledgerAt([on('COMPRA', 200, 100, '2026-06-02')], [], '2026-06-30', { schedules }).income).toEqual([])
    const sold = ledgerAt([on('COMPRA', 200, 100, '2026-04-01'), on('VENTA', 200, 101, '2026-06-02')], [], '2026-06-30', { schedules })
    expect(sold.income.map(i => i.amount)).toEqual([700])
  })

  it('nothing after the date', () => {
    expect(ledgerAt([on('COMPRA', 200, 100, '2026-04-01')], [], '2026-06-01', { schedules }).income).toEqual([])
  })

  it('an amortization returns capital: cash in, cost reduced by the amortized share, quantity unchanged', () => {
    const s = ledgerAt([on('COMPRA', 200, 100, '2026-04-01')], [], '2026-12-31', { schedules })
    expect(s.income.map(i => [i.kind, i.amount])).toEqual([['coupon', 700], ['coupon', 700], ['amortization', 5000]])
    expect(s.holdings[0]).toMatchObject({ quantity: 200, costBasis: 15000 })
    expect(s.cash).toBeCloseTo(6400)
  })

  it('the user can correct a payment amount or mark it not received', () => {
    const overrides = [
      { ticker: 'YM42D', date: '2026-06-02', kind: 'coupon' as const, amount: 690 },
      { ticker: 'YM42D', date: '2026-12-02', kind: 'coupon' as const, amount: null },
    ]
    const s = ledgerAt([on('COMPRA', 200, 100, '2026-04-01')], [], '2026-12-31', { schedules, overrides })
    expect(s.income.map(i => [i.date, i.kind, i.amount, i.source])).toEqual([
      ['2026-06-02', 'coupon', 690, 'user'],
      ['2026-12-02', 'amortization', 5000, 'schedule'],
    ])
  })

  it('a payment no source has, entered by the user, is paid if the user held the bond; an amortization lowers the cost', () => {
    const overrides = [
      { ticker: 'YM42D', date: '2026-09-01', kind: 'coupon' as const, amount: 100 },
      { ticker: 'YM42D', date: '2026-09-01', kind: 'amortization' as const, amount: 2000 },
      { ticker: 'YM42D', date: '2026-03-01', kind: 'coupon' as const, amount: 50 },
    ]
    const s = ledgerAt([on('COMPRA', 200, 100, '2026-04-01')], [], '2026-09-30', { schedules, overrides })
    expect(s.income.map(i => [i.date, i.kind, i.amount, i.source])).toEqual([
      ['2026-06-02', 'coupon', 700, 'schedule'],
      ['2026-09-01', 'coupon', 100, 'user'],
      ['2026-09-01', 'amortization', 2000, 'user'],
    ])
    expect(s.holdings[0].costBasis).toBeCloseTo(18000)
  })
})
