/**
 * The Pesos / MEP / Cable views are a projection of the ledger core
 * (odd/tasks/nucleo-ledger.md T5.3, S5): same order, ticker normalization, sale
 * clamping, closing rules and automatic ON payments; only the FX conversion is theirs.
 */
import { describe, it, expect } from 'vitest'
import { buildCurrencyViews, ledgerInCurrencies, type Amounts, type LedgerTrade } from '../multicurrency'
import { ledgerAt } from '../ledger-core'
import { ledgerNowFrom } from '../ledger-now'
import { fxLookupFrom } from '../trade-record-backfill'

const TODAY = { mep: 1500, ccl: 1600 }
const noFx = fxLookupFrom([])
const ZERO: Amounts = { ARS: 0, MEP: 0, CCL: 0 }

function expectAmounts(actual: Amounts | null | undefined, expected: Amounts) {
  expect(actual).toBeDefined()
  expect(actual!.ARS).toBeCloseTo(expected.ARS, 6)
  expect(actual!.MEP).toBeCloseTo(expected.MEP, 6)
  expect(actual!.CCL).toBeCloseTo(expected.CCL, 6)
}

const SAME_TIME = '2026-01-06T12:00:00Z'
// A CCL-settled share trade at MEP 1000 / CCL 1250: ARS = USD × 1250, MEP = ARS / 1000.
const ccl = (ticker: string, date: string, operation: string, quantity: number, price: number, created_at = `${date}T12:00:00Z`): LedgerTrade => ({
  ticker, date, created_at, operation, asset_type: 'CEDEAR', quantity, price, commission: 0,
  trade_currency: 'CCL', trade_quantity: quantity, trade_price: price, trade_commission: 0, fx_mep: 1000, fx_ccl: 1250,
})
const inCcl = (usd: number): Amounts => ({ ARS: usd * 1250, MEP: (usd * 1250) / 1000, CCL: usd })
const coreOf = (trades: LedgerTrade[]) => ledgerAt(trades.map(t => ({ ...t, created_at: t.created_at ?? null })), [], '9999-12-31')

const views = (trades: LedgerTrade[], extra: Partial<Parameters<typeof buildCurrencyViews>[0]> = {}) => buildCurrencyViews({
  positions: [], onPositions: [], trades, cashBalance: 0, ratios: new Map(), local: new Map(),
  fx: { mep: { rate: 1500, date: '2026-10-22' }, ccl: { rate: 1600, date: '2026-10-22' } }, fxAt: noFx, ...extra,
})

describe('multi-currency views on the ledger core', () => {
  it("lowercase ticker and same-day sell-before-buy rows give the core's holdings", () => {
    const trades = [
      ccl('aapl', '2026-01-05', 'COMPRA', 1, 100),
      // Same day, same insertion time, the sale listed first: the core buys first.
      ccl('AAPL', '2026-01-06', 'VENTA', 1, 120, SAME_TIME),
      ccl('AAPL', '2026-01-06', 'COMPRA', 1, 110, SAME_TIME),
    ]
    const ledger = ledgerInCurrencies(trades, noFx, TODAY)
    const core = coreOf(trades)

    expect([...ledger.keys()]).toEqual(['AAPL'])
    const aapl = ledger.get('AAPL')!
    expect(aapl.quantity).toBe(core.holdings[0].quantity)
    expectAmounts(aapl.cost, inCcl(core.holdings[0].costBasis)) // 105
    expectAmounts(aapl.realized, inCcl(core.realized[0].pnl)) // 15
  })

  it('closes a conversion rounding residue like the core', () => {
    const trades = [
      ccl('X', '2026-01-05', 'COMPRA', 114.67, 10),
      ccl('X', '2026-02-05', 'VENTA', 57.333333, 10),
      ccl('X', '2026-03-05', 'VENTA', 57.333333, 10),
    ]
    expect(coreOf(trades).holdings).toEqual([])
    const x = ledgerInCurrencies(trades, noFx, TODAY).get('X')!
    expect(x.quantity).toBe(0)
    expectAmounts(x.cost, ZERO)
  })

  it('an oversell sells what was held, as the core does', () => {
    const trades = [ccl('KO', '2026-01-05', 'COMPRA', 1, 100), ccl('KO', '2026-02-05', 'VENTA', 2, 120)]
    expect(coreOf(trades).issues.map(i => i.kind)).toEqual(['oversell'])
    const ko = ledgerInCurrencies(trades, noFx, TODAY).get('KO')!
    expect(ko.quantity).toBe(0)
    expectAmounts(ko.realized, inCcl(20))
  })

  it('an automatic ON coupon is in the realized total in all three currencies; an amortization is not', () => {
    const buy: LedgerTrade = {
      ticker: 'YM34D', date: '2026-04-01', created_at: '2026-04-01T12:00:00Z', operation: 'COMPRA', asset_type: 'ON',
      quantity: 100, price: 100, commission: 0,
      trade_currency: 'MEP', trade_quantity: 100, trade_price: 100, trade_commission: 0, fx_mep: 1000, fx_ccl: 1250,
    }
    const schedules = new Map([['YM34D', [{ date: '2026-06-02', ren: 1, amo: 25 }]]])
    // Payment date FX: MEP 1100, CCL 1200.
    const fxAt = fxLookupFrom([
      { date: '2026-06-02', kind: 'mep', buy: 1100, sell: 1100 },
      { date: '2026-06-02', kind: 'ccl', buy: 1200, sell: 1200 },
    ])
    const v = views([buy], { fxAt, payments: { schedules, overrides: [], today: '2026-10-22' } })
    // Coupon 100 × 1 = 100 MEP; the 2.500 MEP amortization is capital returned.
    expectAmounts(v.totals.realized, { ARS: 110_000, MEP: 100, CCL: 110_000 / 1200 })
  })

  it("automatic ON payments: the amortization lowers the cost in all three currencies, the coupon is in the core's cash", () => {
    const buy: LedgerTrade = {
      ticker: 'YM34D', date: '2026-04-01', created_at: '2026-04-01T12:00:00Z', operation: 'COMPRA', asset_type: 'ON',
      quantity: 100, price: 100, commission: 0,
      trade_currency: 'MEP', trade_quantity: 100, trade_price: 100, trade_commission: 0, fx_mep: 1000, fx_ccl: 1250,
    }
    const schedules = new Map([['YM34D', [{ date: '2026-06-02', ren: 1, amo: 25 }]]])
    const state = ledgerNowFrom({ trades: [{ ...buy, created_at: buy.created_at! }], movements: [], overrides: [], splits: new Map() }, schedules, '2026-10-22')
    expect(state.cash).toBe(2600) // coupon 100 + amortization 2500, USD-MEP

    const v = views([buy], {
      onPositions: [{ ticker: 'YM34D', quantity: 100, market_value: 7600 }],
      cashBalance: state.cash,
      payments: { schedules, overrides: [], today: '2026-10-22' },
    })
    // 25 % of the capital returned: cost 10.000 MEP → 7.500 MEP at the purchase FX.
    expectAmounts(v.positions.YM34D.cost, { ARS: 7_500_000, MEP: 7500, CCL: 6000 })
    expect(v.positions.YM34D.costEstimated).toBe(false)
    expectAmounts(v.totals.cash, { ARS: 2600 * 1500, MEP: 2600, CCL: (2600 * 1500) / 1600 })
  })
})
