import { describe, it, expect } from 'vitest'
import { buildPayments, type PaymentTerms } from '../on-payments'
import type { LedgerTrade } from '../ledger-core'
import type { FlowRow } from '../on-flow-history'

const trade = (ticker: string, operation: 'COMPRA' | 'VENTA', quantity: number, date: string): LedgerTrade =>
  ({ ticker, operation, quantity, price: 100, commission: 0, date, asset_type: 'ON', created_at: `${date}T12:00:00Z` })
const TODAY = '2026-10-22'

const LMS8: PaymentTerms = {
  ticker: 'LMS8D', frequency: 'Trimestral', est: 'Tasa Fija', couponRate: 0.09,
  issueDate: '2025-03-21', accrualStart: '2026-09-21', residualPct: 100,
}

describe('buildPayments: Pagos cobrados (S10)', () => {
  const trades = [
    trade('VSCXD', 'COMPRA', 290, '2026-04-09'),
    trade('CS50D', 'COMPRA', 200, '2026-04-09'),
    trade('MGCRD', 'COMPRA', 610, '2026-04-09'),
    trade('TTCDD', 'COMPRA', 400, '2026-04-09'),
    trade('YM42D', 'COMPRA', 100, '2026-01-10'),
    trade('YM42D', 'VENTA', 100, '2026-04-07'),
  ]
  const schedules = new Map<string, FlowRow[]>([
    ['VSCXD', [{ date: '2026-10-09', ren: 3.9375, amo: 0 }]],
    ['CS50D', [{ date: '2026-09-10', ren: 5.4425, amo: 0 }]],
    ['MGCRD', [{ date: '2026-05-14', ren: 3.875, amo: 0 }]],
    ['TTCDD', [{ date: '2026-05-04', ren: 3.8125, amo: 0 }]],
    ['YM42D', [{ date: '2026-06-02', ren: 3.4904, amo: 0 }]],
  ])
  const overrides = [
    { ticker: 'MGCRD', date: '2026-05-14', kind: 'coupon' as const, amount: 2300 },
    { ticker: 'TTCDD', date: '2026-05-04', kind: 'coupon' as const, amount: null },
  ]

  it('lists every payment newest first, marking the ones the user corrected, and a "not received" one with no amount', () => {
    const { payments } = buildPayments({ trades, schedules, overrides, terms: [], today: TODAY })
    expect(payments).toEqual([
      { ticker: 'VSCXD', date: '2026-10-09', kind: 'coupon', amount: 1141.875, corrected: false },
      { ticker: 'CS50D', date: '2026-09-10', kind: 'coupon', amount: 1088.5, corrected: false },
      { ticker: 'MGCRD', date: '2026-05-14', kind: 'coupon', amount: 2300, corrected: true },
      { ticker: 'TTCDD', date: '2026-05-04', kind: 'coupon', amount: null, corrected: true },
    ])
  })

  it('a bond sold before the record date pays nothing (YM42D)', () => {
    const { payments } = buildPayments({ trades, schedules, overrides, terms: [], today: TODAY })
    expect(payments.some(p => p.ticker === 'YM42D')).toBe(false)
  })
})

describe('buildPayments: missing payments (S8)', () => {
  it('asks for the calendar dates no source covers, with a fixed-rate estimate', () => {
    const { missing } = buildPayments({
      trades: [trade('LMS8D', 'COMPRA', 100, '2026-05-01')], schedules: new Map(), overrides: [], terms: [LMS8], today: TODAY,
    })
    // 9% a year, quarterly, 100% residual, 100 × 100 VN: 0.09 × 100 × 3/12 × 1 × 100.
    expect(missing).toEqual([{ ticker: 'LMS8D', payments: [
      { date: '2026-06-21', estimate: 225 },
      { date: '2026-09-21', estimate: 225 },
    ] }])
  })

  it('only asks for dates the user held the bond at the record day', () => {
    const sold = buildPayments({
      trades: [trade('LMS8D', 'COMPRA', 100, '2026-05-01'), trade('LMS8D', 'VENTA', 100, '2026-07-01')],
      schedules: new Map(), overrides: [], terms: [LMS8], today: TODAY,
    })
    expect(sold.missing[0].payments.map(p => p.date)).toEqual(['2026-06-21'])
    const late = buildPayments({
      trades: [trade('LMS8D', 'COMPRA', 100, '2026-07-01')], schedules: new Map(), overrides: [], terms: [LMS8], today: TODAY,
    })
    expect(late.missing[0].payments.map(p => p.date)).toEqual(['2026-09-21'])
    const never = buildPayments({
      trades: [trade('LMS8D', 'COMPRA', 100, '2026-05-01'), trade('LMS8D', 'VENTA', 100, '2026-05-02')],
      schedules: new Map(), overrides: [], terms: [LMS8], today: TODAY,
    })
    expect(never.missing).toEqual([])
  })

  it('gives no estimate when the rate is not fixed', () => {
    const { missing } = buildPayments({
      trades: [trade('LMS8D', 'COMPRA', 100, '2026-05-01')], schedules: new Map(), overrides: [],
      terms: [{ ...LMS8, est: 'Tasa Variable' }], today: TODAY,
    })
    expect(missing[0].payments.map(p => p.estimate)).toEqual([null, null])
  })

  it('a date the user already answered (loaded or "No lo cobré") is no longer missing, and the loaded one is listed', () => {
    const { missing, payments } = buildPayments({
      trades: [trade('LMS8D', 'COMPRA', 100, '2026-05-01')], schedules: new Map(),
      overrides: [
        { ticker: 'LMS8D', date: '2026-06-21', kind: 'coupon', amount: 220 },
        { ticker: 'LMS8D', date: '2026-09-21', kind: 'coupon', amount: null },
      ],
      terms: [LMS8], today: TODAY,
    })
    expect(missing).toEqual([])
    expect(payments).toEqual([
      { ticker: 'LMS8D', date: '2026-09-21', kind: 'coupon', amount: null, corrected: true },
      { ticker: 'LMS8D', date: '2026-06-21', kind: 'coupon', amount: 220, corrected: true },
    ])
  })
})
