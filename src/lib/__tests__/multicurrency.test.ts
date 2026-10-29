/**
 * The portfolio in pesos, dólar MEP and dólar cable ("Stage C decisions" in
 * odd/tasks/multimoneda.md). One test per rule; every output is asserted.
 */
import { describe, it, expect } from 'vitest'
import type { Quote } from '@/types'
import { buildCurrencyViews, localSymbol, ledgerInCurrencies, valuePosition, type Amounts, type LedgerTrade } from '../multicurrency'
import { fxLookupFrom } from '../trade-record-backfill'

const TODAY = { mep: 1500, ccl: 1600 }
const noFx = fxLookupFrom([])

function expectAmounts(actual: Amounts | null | undefined, expected: Amounts) {
  expect(actual).not.toBeNull()
  expect(Object.keys(actual!).sort()).toEqual(['ARS', 'CCL', 'MEP'])
  expect(actual!.ARS).toBeCloseTo(expected.ARS, 6)
  expect(actual!.MEP).toBeCloseTo(expected.MEP, 6)
  expect(actual!.CCL).toBeCloseTo(expected.CCL, 6)
}

const ZERO: Amounts = { ARS: 0, MEP: 0, CCL: 0 }

function trade(t: Partial<LedgerTrade> & Pick<LedgerTrade, 'ticker' | 'date' | 'operation'>): LedgerTrade {
  return {
    asset_type: 'ACCION', quantity: 0, price: 0, commission: 0,
    trade_currency: null, trade_quantity: null, trade_price: null, trade_commission: null,
    fx_mep: null, fx_ccl: null, created_at: `${t.date}T12:00:00Z`,
    ...t,
  }
}

// A CCL-settled share trade: the trade record mirrors the engine values.
const ccl = (ticker: string, date: string, operation: string, quantity: number, price: number, fx_mep: number, fx_ccl: number, commission = 0) =>
  trade({ ticker, date, operation, quantity, price, commission, trade_currency: 'CCL', trade_quantity: quantity, trade_price: price, trade_commission: commission, fx_mep, fx_ccl })

const quote = (ticker: string, price: number, changePercent: number): Quote => ({ ticker, price, change: 0, changePercent, previousClose: price })

describe('cost per lot, from the trade record', () => {
  it('ARS trade: trade_price × trade_quantity plus commission, MEP and CCL with the trade FX', () => {
    const ledger = ledgerInCurrencies([
      trade({
        ticker: 'AAPL', date: '2026-05-04', operation: 'COMPRA', asset_type: 'CEDEAR',
        quantity: 0.5, price: 320, commission: 0.4,
        trade_currency: 'ARS', trade_quantity: 10, trade_price: 20000, trade_commission: 500, fx_mep: 1000, fx_ccl: 1250,
      }),
    ], noFx, TODAY)

    const aapl = ledger.get('AAPL')!
    expect(aapl.quantity).toBe(0.5)
    expectAmounts(aapl.cost, { ARS: 200500, MEP: 200.5, CCL: 160.4 })
    expectAmounts(aapl.realized, ZERO)
    expect(aapl.costEstimated).toBe(false)
    expect([...ledger.keys()]).toEqual(['AAPL'])
  })

  it('MEP trade: trade_price × trade_quantity plus commission, times fx_mep', () => {
    const ledger = ledgerInCurrencies([
      trade({
        ticker: 'YM34D', date: '2026-05-04', operation: 'COMPRA', asset_type: 'ON',
        quantity: 100, price: 109, commission: 10,
        trade_currency: 'MEP', trade_quantity: 100, trade_price: 109, trade_commission: 10, fx_mep: 1000, fx_ccl: 1250,
      }),
    ], noFx, TODAY)

    const on = ledger.get('YM34D')!
    expect(on.quantity).toBe(100)
    expectAmounts(on.cost, { ARS: 10_910_000, MEP: 10_910, CCL: 8728 })
    expectAmounts(on.realized, ZERO)
    expect(on.costEstimated).toBe(false)
  })

  it('CCL / reconstructed trade: engine price × |quantity| plus commission, times fx_ccl', () => {
    const ledger = ledgerInCurrencies([ccl('MSFT', '2026-05-04', 'COMPRA', 2, 400, 1000, 1250, 1)], noFx, TODAY)

    const msft = ledger.get('MSFT')!
    expect(msft.quantity).toBe(2)
    expectAmounts(msft.cost, { ARS: 1_001_250, MEP: 1001.25, CCL: 801 })
    expectAmounts(msft.realized, ZERO)
    expect(msft.costEstimated).toBe(false)
  })

  it('a row without a trade record uses the engine values (ON as MEP, the rest as CCL) and the FX of its date', () => {
    const fxAt = fxLookupFrom([
      { date: '2026-05-01', kind: 'mep', buy: 990, sell: 1010 },   // 1000
      { date: '2026-05-01', kind: 'ccl', buy: 1240, sell: 1260 },  // 1250
    ])
    const ledger = ledgerInCurrencies([
      trade({ ticker: 'YM34D', date: '2026-05-04', operation: 'COMPRA', asset_type: 'ON', quantity: 10, price: 100, commission: 0 }),
      trade({ ticker: 'KO', date: '2026-05-04', operation: 'COMPRA', quantity: 1, price: 60, commission: 0 }),
      // Before any reference FX: today's FX, flagged.
      trade({ ticker: 'OLD', date: '2010-01-04', operation: 'COMPRA', quantity: 1, price: 16, commission: 0 }),
    ], fxAt, TODAY)

    expectAmounts(ledger.get('YM34D')!.cost, { ARS: 1_000_000, MEP: 1000, CCL: 800 })
    expect(ledger.get('YM34D')!.costEstimated).toBe(false)
    expectAmounts(ledger.get('KO')!.cost, { ARS: 75_000, MEP: 75, CCL: 60 })
    expect(ledger.get('KO')!.costEstimated).toBe(false)
    expectAmounts(ledger.get('OLD')!.cost, { ARS: 25_600, MEP: 25_600 / 1500, CCL: 16 })
    expect(ledger.get('OLD')!.costEstimated).toBe(true)
  })
})

describe('average cost per currency (Cocos semantics)', () => {
  // Two buys at different FX, then a partial sale at a third FX.
  const history = [
    ccl('MSFT', '2026-01-05', 'COMPRA', 2, 400, 1000, 1250),  // ARS 1.000.000, MEP 1000, CCL 800
    ccl('MSFT', '2026-02-05', 'COMPRA', 2, 500, 1200, 1500),  // ARS 1.500.000, MEP 1250, CCL 1000
    ccl('MSFT', '2026-03-05', 'VENTA', 1, 600, 1600, 2000),   // proceeds ARS 1.200.000, MEP 750, CCL 600
  ]

  it('a sale leaves the average unchanged', () => {
    const msft = ledgerInCurrencies(history, noFx, TODAY).get('MSFT')!
    expect(msft.quantity).toBe(3)
    // Average before the sale: ARS 625.000, MEP 562,5, CCL 450 per share.
    expectAmounts(msft.cost, { ARS: 1_875_000, MEP: 1687.5, CCL: 1350 })
    expect(msft.costEstimated).toBe(false)
  })

  it('a full close resets the average', () => {
    const ko = ledgerInCurrencies([
      ccl('KO', '2026-01-05', 'COMPRA', 1, 400, 1000, 1250),
      ccl('KO', '2026-02-05', 'VENTA', 1, 500, 1000, 1250),
      ccl('KO', '2026-03-05', 'COMPRA', 1, 300, 1600, 2000),
    ], noFx, TODAY).get('KO')!
    expect(ko.quantity).toBe(1)
    expectAmounts(ko.cost, { ARS: 600_000, MEP: 375, CCL: 300 })
    expectAmounts(ko.realized, { ARS: 625_000 - 500_000, MEP: 625 - 500, CCL: 100 })
  })
})

describe('realized result per currency', () => {
  it('converts the sale proceeds with the FX of the sale', () => {
    const msft = ledgerInCurrencies([
      ccl('MSFT', '2026-01-05', 'COMPRA', 2, 400, 1000, 1250),
      ccl('MSFT', '2026-02-05', 'COMPRA', 2, 500, 1200, 1500),
      ccl('MSFT', '2026-03-05', 'VENTA', 1, 600, 1600, 2000, 5),
    ], noFx, TODAY).get('MSFT')!
    // Proceeds (600 − 5) × 2000 = 1.190.000 ARS; average released 625.000 / 562,5 / 450.
    expectAmounts(msft.realized, { ARS: 565_000, MEP: 743.75 - 562.5, CCL: 595 - 450 })
  })

  it('dividends and coupons are income, converted with the FX of their date, not a sale result', () => {
    const ledger = ledgerInCurrencies([
      ccl('KO', '2026-04-01', 'DIVIDENDO', 1, 10, 1000, 1250),
      trade({
        ticker: 'YM34D', date: '2026-04-02', operation: 'CUPON', asset_type: 'ON', quantity: 50, price: 1,
        trade_currency: 'MEP', trade_quantity: 50, trade_price: 1, trade_commission: 0, fx_mep: 1100, fx_ccl: 1200,
      }),
    ], noFx, TODAY)
    expectAmounts(ledger.get('KO')!.income, { ARS: 12_500, MEP: 12.5, CCL: 10 })
    expectAmounts(ledger.get('KO')!.realized, ZERO)
    expectAmounts(ledger.get('KO')!.cost, ZERO)
    expect(ledger.get('KO')!.quantity).toBe(0)
    expectAmounts(ledger.get('YM34D')!.income, { ARS: 55_000, MEP: 50, CCL: 55_000 / 1200 })
  })
})

describe('value today per position', () => {
  const ctx = {
    ratios: new Map([['AAPL', 20], ['NVDA', 24]]),
    local: new Map([['AAPL', quote('AAPL', 28_420, 0.0121)], ['GGAL', quote('GGAL', 7000, -0.02)]]),
    fx: TODAY,
  }

  it('CEDEAR with a local price: quantity × ratio × peso price', () => {
    const v = valuePosition({ kind: 'stock', ticker: 'AAPL', quantity: 0.5, market_value: 130, day_change_pct: 0.01 }, ctx)
    expectAmounts(v.value, { ARS: 284_200, MEP: 284_200 / 1500, CCL: 177.625 })
    expect(v.dayChangePct).toBe(0.0121)
    expect(v.source).toBe('local')
    expect(v.estimated).toBe(false)
  })

  it('local stock (BCBA:) with a local price: quantity × peso price', () => {
    const v = valuePosition({ kind: 'stock', ticker: 'BCBA:GGAL', quantity: 10, market_value: 40, day_change_pct: 0 }, ctx)
    expectAmounts(v.value, { ARS: 70_000, MEP: 70_000 / 1500, CCL: 43.75 })
    expect(v.dayChangePct).toBe(-0.02)
    expect(v.source).toBe('local')
    expect(v.estimated).toBe(false)
  })

  it('ON: its MEP value × today MEP', () => {
    const v = valuePosition({ kind: 'on', ticker: 'YM34D', quantity: 100, market_value: 11_000, day_change_pct: 0.0027 }, ctx)
    expectAmounts(v.value, { ARS: 16_500_000, MEP: 11_000, CCL: 10_312.5 })
    expect(v.dayChangePct).toBe(0.0027)
    expect(v.source).toBe('mep')
    expect(v.estimated).toBe(false)
  })

  it('without a local price: engine USD-CCL value × today CCL, flagged as estimated', () => {
    for (const ticker of ['DIS', 'NVDA']) { // not a CEDEAR / a CEDEAR with no peso price cached
      const v = valuePosition({ kind: 'stock', ticker, quantity: 2, market_value: 300, day_change_pct: -0.01 }, ctx)
      expectAmounts(v.value, { ARS: 480_000, MEP: 320, CCL: 300 })
      expect(v.dayChangePct).toBe(-0.01)
      expect(v.source).toBe('estimated')
      expect(v.estimated).toBe(true)
    }
  })

  it('no price at all: no value, never an invented one', () => {
    const v = valuePosition({ kind: 'stock', ticker: 'DIS', quantity: 2 }, ctx)
    expect(v).toEqual({ value: null, dayChangePct: null, source: null, estimated: false })
  })

  it('peso-line symbol of a held ticker', () => {
    expect(localSymbol('AAPL')).toBe('AAPL')
    expect(localSymbol('BCBA:GGAL')).toBe('GGAL')
    expect(localSymbol(' bcba:ypfd ')).toBe('YPFD')
  })
})

describe('totals with cash', () => {
  const input = {
    positions: [
      { ticker: 'AAPL', quantity: 0.5, market_value: 130, day_change_pct: 0.01 },
      { ticker: 'DIS', quantity: 2, market_value: 300, day_change_pct: -0.01 },
      { ticker: 'MISS', quantity: 1 }, // unpriced: out of the totals, as in the engine
    ],
    onPositions: [{ ticker: 'YM34D', quantity: 100, market_value: 11_000, day_change_pct: 0.1 }],
    trades: [
      trade({
        ticker: 'AAPL', date: '2026-05-04', operation: 'COMPRA', asset_type: 'CEDEAR', quantity: 0.5, price: 320,
        trade_currency: 'ARS', trade_quantity: 10, trade_price: 20_000, trade_commission: 0, fx_mep: 1000, fx_ccl: 1250,
      }),
      ccl('DIS', '2026-05-04', 'COMPRA', 2, 100, 1000, 1250),
      ccl('MISS', '2026-05-04', 'COMPRA', 1, 50, 1000, 1250),
      trade({
        ticker: 'YM34D', date: '2026-05-04', operation: 'COMPRA', asset_type: 'ON', quantity: 100, price: 100,
        trade_currency: 'MEP', trade_quantity: 100, trade_price: 100, trade_commission: 0, fx_mep: 1000, fx_ccl: 1250,
      }),
      ccl('KO', '2026-01-05', 'COMPRA', 1, 400, 1000, 1250),
      ccl('KO', '2026-02-05', 'VENTA', 1, 500, 1000, 1250),
      ccl('KO', '2026-03-01', 'DIVIDENDO', 1, 2, 1000, 1250),
    ],
    cashBalance: 100,
    ratios: new Map([['AAPL', 20]]),
    local: new Map([['AAPL', quote('AAPL', 28_420, 0.25)]]),
    fx: { mep: { rate: 1500, date: '2026-10-21' }, ccl: { rate: 1600, date: '2026-10-21' } },
    fxAt: noFx,
  }

  it('cash is the broker dollar balance, i.e. dólar MEP: ARS = balance × MEP today, CCL = ARS / CCL today', () => {
    const v = buildCurrencyViews(input)
    expectAmounts(v.totals.cash, { ARS: 150_000, MEP: 100, CCL: 150_000 / 1600 })
  })

  it('totals: value with cash, invested and open result of priced positions, realized with income', () => {
    const v = buildCurrencyViews(input)
    expect(v.version).toBe(1)
    expect(v.fx).toEqual({ mep: 1500, ccl: 1600, mepDate: '2026-10-21', cclDate: '2026-10-21' })

    // Values: AAPL 284.200, DIS 480.000, YM34D 16.500.000, cash 150.000 (ARS).
    const valueArs = 284_200 + 480_000 + 16_500_000 + 150_000
    expectAmounts(v.totals.value, { ARS: valueArs, MEP: valueArs / 1500, CCL: valueArs / 1600 })
    expectAmounts(v.totals.stocks, { ARS: 764_200, MEP: 764_200 / 1500, CCL: 764_200 / 1600 })
    expectAmounts(v.totals.ons, { ARS: 16_500_000, MEP: 11_000, CCL: 16_500_000 / 1600 })

    // Cost of priced open positions: AAPL 200.000 ARS, DIS 250.000 ARS, YM34D 10.000.000 ARS (MISS left out).
    expectAmounts(v.totals.invested, { ARS: 10_450_000, MEP: 10_450, CCL: 8360 })
    expectAmounts(v.totals.openPnl, {
      ARS: valueArs - 150_000 - 10_450_000,
      MEP: (valueArs - 150_000) / 1500 - 10_450,
      CCL: (valueArs - 150_000) / 1600 - 8360,
    })
    expectAmounts(v.totals.openPnlPct, {
      ARS: (valueArs - 150_000 - 10_450_000) / 10_450_000,
      MEP: ((valueArs - 150_000) / 1500 - 10_450) / 10_450,
      CCL: ((valueArs - 150_000) / 1600 - 8360) / 8360,
    })
    // KO: sold for 100 CCL over cost (125.000 ARS at 1250), plus a 2 CCL dividend (2.500 ARS).
    expectAmounts(v.totals.realized, { ARS: 127_500, MEP: 127.5, CCL: 102 })
    expect(v.estimated).toBe(true) // DIS is valued with Yahoo × CCL
  })

  it('per class: open result of priced positions and realized with income, stocks apart from ONs', () => {
    // A 50 MEP coupon on the ON (no ticket: typed in MEP, 50.000 ARS at 1000).
    const coupon = trade({ ticker: 'YM34D', date: '2026-06-01', operation: 'CUPON', asset_type: 'ON', quantity: 1, price: 50, fx_mep: 1000, fx_ccl: 1250 })
    const v = buildCurrencyViews({ ...input, trades: [...input.trades, coupon] })

    // Stocks: AAPL 284.200 + DIS 480.000 ARS against a cost of 200.000 + 250.000 ARS (MEP 450, CCL 360).
    expectAmounts(v.totals.byClass?.stocks.openPnl, { ARS: 314_200, MEP: 764_200 / 1500 - 450, CCL: 764_200 / 1600 - 360 })
    expectAmounts(v.totals.byClass?.stocks.realized, { ARS: 127_500, MEP: 127.5, CCL: 102 })
    // ONs: 16.500.000 ARS against 10.000.000 ARS (MEP 10.000, CCL 8.000); the coupon is ON income.
    expectAmounts(v.totals.byClass?.ons.openPnl, { ARS: 6_500_000, MEP: 1000, CCL: 16_500_000 / 1600 - 8000 })
    expectAmounts(v.totals.byClass?.ons.realized, { ARS: 50_000, MEP: 50, CCL: 40 })
    expectAmounts(v.totals.realized, { ARS: 177_500, MEP: 177.5, CCL: 142 })
  })

  it('per position: value, cost, average cost, result, price, day change and flags', () => {
    const v = buildCurrencyViews(input)
    expect(Object.keys(v.positions).sort()).toEqual(['AAPL', 'DIS', 'MISS', 'YM34D'])

    const aapl = v.positions.AAPL
    expectAmounts(aapl.value, { ARS: 284_200, MEP: 284_200 / 1500, CCL: 177.625 })
    expectAmounts(aapl.cost, { ARS: 200_000, MEP: 200, CCL: 160 })
    expectAmounts(aapl.avgCost, { ARS: 400_000, MEP: 400, CCL: 320 })
    expectAmounts(aapl.pnl, { ARS: 84_200, MEP: 284_200 / 1500 - 200, CCL: 17.625 })
    expectAmounts(aapl.pnlPct, { ARS: 0.421, MEP: (284_200 / 1500 - 200) / 200, CCL: 17.625 / 160 })
    expectAmounts(aapl.price, { ARS: 568_400, MEP: 568_400 / 1500, CCL: 355.25 })
    expect(aapl.dayChangePct).toBe(0.25)
    expect(aapl.source).toBe('local')
    expect(aapl.estimated).toBe(false)
    expect(aapl.costEstimated).toBe(false)

    const miss = v.positions.MISS
    expect(miss.value).toBeNull()
    expect(miss.pnl).toBeNull()
    expect(miss.pnlPct).toBeNull()
    expect(miss.price).toBeNull()
    expect(miss.dayChangePct).toBeNull()
    expect(miss.source).toBeNull()
    expectAmounts(miss.cost, { ARS: 62_500, MEP: 62.5, CCL: 50 })
  })

  it('day change: each position value × p / (1 + p) at today FX, and its share of invested', () => {
    const v = buildCurrencyViews(input)
    // AAPL +25 % on the peso line: 284.200 × 0,25 / 1,25 = 56.840 ARS.
    // DIS −1 % (Yahoo): 480.000 × −0,01 / 0,99. YM34D +10 %: 16.500.000 × 0,1 / 1,1 = 1.500.000.
    const dayArs = 56_840 + (480_000 * -0.01) / 0.99 + 1_500_000
    expectAmounts(v.positions.AAPL.dayChange, { ARS: 56_840, MEP: 56_840 / 1500, CCL: 35.525 })
    expect(v.positions.MISS.dayChange).toBeNull()
    expectAmounts(v.totals.dayChange, { ARS: dayArs, MEP: dayArs / 1500, CCL: dayArs / 1600 })
    expectAmounts(v.totals.dayChangePct, { ARS: dayArs / 10_450_000, MEP: dayArs / 1500 / 10_450, CCL: dayArs / 1600 / 8360 })
  })

  it('flags the cost as estimated when the replayed quantity does not match the position', () => {
    const v = buildCurrencyViews({ ...input, positions: [{ ticker: 'DIS', quantity: 3, market_value: 450 }], onPositions: [] })
    expect(v.positions.DIS.costEstimated).toBe(true)
  })
})
