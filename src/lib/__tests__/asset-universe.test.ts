import { describe, it, expect } from 'vitest'
import {
  isUniverse,
  projectHistory,
  projectSeries,
  universeFlows,
  computeUniverseRiskMetrics,
  metricsRows,
  MIN_INTERVALS_ANNUALIZED,
  MIN_INTERVALS_DRAWDOWN,
} from '../asset-universe'
import type {
  ProjectableSnapshot,
  FlowTransaction,
  UniverseFlowInputs,
  IncomeMovement,
} from '../asset-universe'

const snap = (
  snapshot_date: string,
  over: Partial<ProjectableSnapshot> = {}
): ProjectableSnapshot => ({
  snapshot_date,
  total_value: 1000,
  total_invested: 800,
  stocks_value: 600,
  stocks_invested: 500,
  ons_value: 300,
  ons_invested: 300,
  cash_value: 100,
  ...over,
})

describe('isUniverse', () => {
  it('accepts the four universes', () => {
    for (const u of ['total', 'measurable', 'stocks', 'ons']) {
      expect(isUniverse(u)).toBe(true)
    }
  })

  it('rejects anything else', () => {
    expect(isUniverse('cash')).toBe(false)
    expect(isUniverse('')).toBe(false)
    expect(isUniverse('TOTAL')).toBe(false)
  })
})

describe('projectHistory', () => {
  it('total projects total_value / total_invested', () => {
    const [p] = projectHistory([snap('2026-07-01')], 'total')
    expect(p).toEqual({ snapshot_date: '2026-07-01', value: 1000, invested: 800 })
  })

  it('measurable is stocks_value + cash_value and EXCLUDES ONs; invested excludes cash by design', () => {
    const [p] = projectHistory([snap('2026-07-01')], 'measurable')
    expect(p.value).toBe(700) // 600 + 100, not 1000
    expect(p.invested).toBe(500) // stocks_invested only
  })

  it('stocks and ons project their own pair', () => {
    const [s] = projectHistory([snap('2026-07-01')], 'stocks')
    const [o] = projectHistory([snap('2026-07-01')], 'ons')
    expect([s.value, s.invested]).toEqual([600, 500])
    expect([o.value, o.invested]).toEqual([300, 300])
  })

  it('DROPS a null-breakdown row for measurable/stocks/ons but keeps it for total', () => {
    const rows = [
      snap('2026-07-01'),
      snap('2026-07-02', {
        stocks_value: null, stocks_invested: null,
        ons_value: null, ons_invested: null, cash_value: null,
      }),
    ]
    expect(projectHistory(rows, 'total')).toHaveLength(2)
    expect(projectHistory(rows, 'measurable')).toHaveLength(1)
    expect(projectHistory(rows, 'stocks')).toHaveLength(1)
    expect(projectHistory(rows, 'ons')).toHaveLength(1)
  })

  it('DROPS a row whose breakdown fields are absent (pre-034 row), never coerces to 0', () => {
    const bare: ProjectableSnapshot = {
      snapshot_date: '2026-07-03', total_value: 1000, total_invested: 800,
    }
    expect(projectHistory([bare], 'measurable')).toEqual([])
    expect(projectHistory([bare], 'ons')).toEqual([])
  })

  it('DROPS a non-finite value instead of letting it pass silently', () => {
    expect(projectHistory([snap('2026-07-04', { stocks_value: NaN })], 'stocks')).toEqual([])
    expect(projectHistory([snap('2026-07-04', { cash_value: Infinity })], 'measurable')).toEqual([])
  })

  it('propagates source when present', () => {
    const [p] = projectHistory([snap('2026-07-05', { source: 'estimated' })], 'stocks')
    expect(p.source).toBe('estimated')
  })

  it('empty input returns empty, never throws', () => {
    expect(projectHistory([], 'measurable')).toEqual([])
  })
})

describe('projectHistory — out-of-union universe', () => {
  it('returns nothing for a universe outside the union reached via a cast', () => {
    // isUniverse gates both routes, so this is only reachable by a cast — but
    // the switch must not fall through leaving value/invested unassigned,
    // which would emit {value: undefined} and reach the metrics as NaN.
    const bogus = 'crypto' as unknown as Parameters<typeof projectHistory>[1]
    expect(projectHistory([snap('2026-07-01')], bogus)).toEqual([])
  })
})

describe('projectSeries', () => {
  it('maps the projected value onto SnapshotPoint.total_value for the metrics pipeline', () => {
    const [p] = projectSeries([snap('2026-07-01')], 'measurable')
    expect(p).toEqual({ snapshot_date: '2026-07-01', total_value: 700 })
  })
})

const tx = (over: Partial<FlowTransaction> = {}): FlowTransaction => ({
  date: '2026-07-10',
  operation: 'COMPRA',
  quantity: 10,
  price: 100,
  commission: 5,
  asset_type: 'ACCION',
  ...over,
})

const inputs = (over: Partial<UniverseFlowInputs> = {}): UniverseFlowInputs => ({
  externalFlows: [],
  transactions: [],
  income: [],
  ...over,
})

const coupon = (over: Partial<IncomeMovement> = {}): IncomeMovement => ({
  date: '2026-07-10',
  type: 'CUPON',
  amount: 8300,
  ...over,
})

describe('universeFlows', () => {
  const external = [{ date: '2026-07-01', amount: 21000 }]

  it('returns external flows unchanged for total, and for measurable when no ON was traded', () => {
    expect(universeFlows('total', inputs({ externalFlows: external, transactions: [tx()] }))).toEqual(external)
    expect(universeFlows('measurable', inputs({ externalFlows: external, transactions: [tx()] }))).toEqual(external)
  })

  it('total ignores the transaction list entirely — every trade is internal to it', () => {
    expect(universeFlows('total', inputs({
      transactions: [
        tx({ asset_type: 'ON', price: 100.5, quantity: 250 }),
        tx({ asset_type: 'ACCION' }),
      ],
    }))).toEqual([])
  })

  it('a STOCK buy inside measurable produces NO flow — the gain-that-isn\'t (spec A1)', () => {
    // A stock purchase is internal to stocks+cash: cash goes down, stocks go
    // up, the universe's value is unchanged. Only real deposits/withdrawals
    // and ON trades cross it.
    expect(universeFlows('measurable', inputs({ transactions: [tx({ quantity: 100, price: 100 })] }))).toEqual([])
  })

  it('an ON BUY is cash LEAVING measurable — a negative flow, not a loss', () => {
    // measurable is stocks_value + cash_value; ONs are OUTSIDE it. Without
    // this the purchase reads as a fall in value. Measured on the live
    // series 2026-07-02: −10.09%, of which 96% was one bond purchase.
    expect(universeFlows('measurable', inputs({
      transactions: [tx({ asset_type: 'ON', quantity: 250, price: 100.5, commission: 0 })],
    }))).toEqual([{ date: '2026-07-10', amount: -25125 }])
  })

  it('an ON SELL is cash ENTERING measurable — a positive flow, not a gain', () => {
    expect(universeFlows('measurable', inputs({
      transactions: [tx({ asset_type: 'ON', operation: 'VENTA', quantity: -70, price: 100, commission: 0 })],
    }))).toEqual([{ date: '2026-07-10', amount: 7000 }])
  })

  it('measurable is the exact MIRROR of the ons universe on the same trades', () => {
    const rows = [
      tx({ asset_type: 'ON', quantity: 250, price: 100.5, commission: 3 }),
      tx({ asset_type: 'ON', operation: 'VENTA', quantity: -70, price: 100, date: '2026-07-11' }),
      tx({ asset_type: 'ACCION' }), // internal to measurable, IN for stocks
    ]
    const ons = universeFlows('ons', inputs({ transactions: rows }))
    const measurable = universeFlows('measurable', inputs({ transactions: rows }))
    expect(measurable).toEqual(ons.map((f) => ({ date: f.date, amount: -f.amount })))
  })

  it('measurable merges an external flow and an ON trade landing on the SAME date', () => {
    expect(universeFlows('measurable', inputs({
      externalFlows: [{ date: '2026-07-10', amount: 21000 }],
      transactions: [tx({ asset_type: 'ON', quantity: 250, price: 100.5, commission: 0 })],
    }))).toEqual([{ date: '2026-07-10', amount: -4125 }]) // 21000 − 25125
  })

  it('measurable omits a date where an external flow and an ON trade cancel exactly', () => {
    expect(universeFlows('measurable', inputs({
      externalFlows: [{ date: '2026-07-10', amount: 25125 }],
      transactions: [tx({ asset_type: 'ON', quantity: 250, price: 100.5, commission: 0 })],
    }))).toEqual([])
  })

  it('measurable sorts merged flows by date', () => {
    const flows = universeFlows('measurable', inputs({
      externalFlows: [{ date: '2026-07-20', amount: 500 }],
      transactions: [tx({ asset_type: 'ON', date: '2026-07-05', quantity: 1, price: 100, commission: 0 })],
    }))
    expect(flows.map((f) => f.date)).toEqual(['2026-07-05', '2026-07-20'])
  })

  it('measurable ignores a null asset_type trade — fail closed, same as the class universes', () => {
    expect(universeFlows('measurable', inputs({ transactions: [tx({ asset_type: null })] }))).toEqual([])
  })

  it('measurable does not alias the caller\'s external-flow array', () => {
    const caller = [{ date: '2026-07-01', amount: 21000 }]
    const flows = universeFlows('measurable', inputs({ externalFlows: caller }))
    expect(flows).not.toBe(caller)
    expect(flows).toEqual(caller)
  })

  it('COMPRA flows cost INTO stocks: qty × price + commission', () => {
    expect(universeFlows('stocks', inputs({ externalFlows: external, transactions: [tx()] }))).toEqual([
      { date: '2026-07-10', amount: 1005 },
    ])
  })

  it('VENTA flows proceeds OUT of stocks: −(qty × price − commission)', () => {
    expect(universeFlows('stocks', inputs({ transactions: [tx({ operation: 'VENTA' })] }))).toEqual([
      { date: '2026-07-10', amount: -995 },
    ])
  })

  it('VENTA with the DB\'s negative-quantity convention still flows OUT', () => {
    // Real rows store sells as negative quantity (001_schema.sql: positive=buy,
    // negative=sell); the operation, not the sign, determines direction.
    expect(universeFlows('stocks', inputs({ transactions: [tx({ operation: 'VENTA', quantity: -10 })] }))).toEqual([
      { date: '2026-07-10', amount: -995 },
    ])
  })

  it('COMPRA with a hypothetical negative quantity still flows IN — direction comes from the operation alone', () => {
    expect(universeFlows('stocks', inputs({ transactions: [tx({ quantity: -10 })] }))).toEqual([
      { date: '2026-07-10', amount: 1005 },
    ])
  })

  it('nets same-day buys and sells per date and sorts by date', () => {
    const flows = universeFlows('stocks', inputs({
      transactions: [
        tx({ date: '2026-07-11', quantity: 1, price: 50, commission: 0 }),
        tx(),
        tx({ operation: 'VENTA' }),
      ],
    }))
    expect(flows).toEqual([
      { date: '2026-07-10', amount: 10 }, // 1005 − 995
      { date: '2026-07-11', amount: 50 },
    ])
  })

  it('omits a date whose net is exactly zero', () => {
    const flows = universeFlows('stocks', inputs({
      transactions: [
        tx({ commission: 0 }),
        tx({ operation: 'VENTA', commission: 0 }),
      ],
    }))
    expect(flows).toEqual([])
  })

  it('routes by asset_type, NEVER by ticker suffix: ON goes to ons, ACCION never does', () => {
    const rows = [tx({ asset_type: 'ON', price: 100.5, quantity: 250, commission: 0 })]
    expect(universeFlows('ons', inputs({ transactions: rows }))).toEqual([
      { date: '2026-07-10', amount: 25125 },
    ])
    // AMD is an ACCION whose ticker ends in D — FlowTransaction carries no
    // ticker at all, so the ON universe cannot even see it.
    expect(universeFlows('ons', inputs({ transactions: [tx({ asset_type: 'ACCION' })] }))).toEqual([])
    expect(universeFlows('stocks', inputs({ transactions: rows }))).toEqual([])
  })

  it('CEDEAR routes to stocks', () => {
    expect(universeFlows('stocks', inputs({ transactions: [tx({ asset_type: 'CEDEAR' })] }))).toEqual([
      { date: '2026-07-10', amount: 1005 },
    ])
  })

  it('excludes null asset_type from BOTH class universes — fail closed', () => {
    const rows = [tx({ asset_type: null })]
    expect(universeFlows('stocks', inputs({ transactions: rows }))).toEqual([])
    expect(universeFlows('ons', inputs({ transactions: rows }))).toEqual([])
  })

  it('normalizes asset_type: padding and case must not lose a trade', () => {
    // Sibling routers normalize (backfill-snapshots.ts, migrations 019/031 UPPER
    // without TRIM). An unnormalized ' ON' matches NEITHER predicate, and for
    // measurable "no match" silently means "internal" — which reinstates the
    // fabricated loss this branch exists to kill. Fail open is worse here than
    // anywhere else, so the comparison is normalized.
    for (const raw of [' ON', 'on', ' on ', 'On']) {
      expect(universeFlows('ons', inputs({ transactions: [tx({ asset_type: raw, quantity: 250, price: 100.5, commission: 0 })] })))
        .toEqual([{ date: '2026-07-10', amount: 25125 }])
      expect(universeFlows('measurable', inputs({ transactions: [tx({ asset_type: raw, quantity: 250, price: 100.5, commission: 0 })] })))
        .toEqual([{ date: '2026-07-10', amount: -25125 }])
    }
    for (const raw of [' accion', 'ACCION ', 'cedear']) {
      expect(universeFlows('stocks', inputs({ transactions: [tx({ asset_type: raw })] })))
        .toEqual([{ date: '2026-07-10', amount: 1005 }])
    }
  })

  it('an empty-string asset_type is still refused by both class universes', () => {
    const rows = [tx({ asset_type: '   ' })]
    expect(universeFlows('stocks', inputs({ transactions: rows }))).toEqual([])
    expect(universeFlows('ons', inputs({ transactions: rows }))).toEqual([])
  })

  it('ignores DIVIDENDO — it does not cross the value boundary', () => {
    expect(universeFlows('stocks', inputs({ transactions: [tx({ operation: 'DIVIDENDO' })] }))).toEqual([])
  })

  it('treats null commission as 0', () => {
    expect(universeFlows('stocks', inputs({ transactions: [tx({ commission: null })] }))).toEqual([
      { date: '2026-07-10', amount: 1000 },
    ])
  })

  it('refuses a non-finite row instead of poisoning the net', () => {
    expect(universeFlows('stocks', inputs({ transactions: [tx({ price: NaN })] }))).toEqual([])
  })

  it('empty inputs return empty, never throw', () => {
    expect(universeFlows('stocks', inputs())).toEqual([])
    expect(universeFlows('ons', inputs())).toEqual([])
  })
})

describe('universeFlows — income crosses the boundary of the universe it left or entered', () => {
  it('an ON coupon is NOT a flow in the ons universe — the day is not measured at all', () => {
    // A `−amount` flow here would be a BET on how ons_value moved. It is
    // right when the leg was priced (the dirty price falls by the payment)
    // and wrong when the leg fell back to cost (`missingQuotePolicy:
    // 'avg_cost'`, and that row still counts as live), where the value does
    // not fall but the flow subtracts anyway: factor = (C + A) / C, a
    // fabricated GAIN the size of the coupon — the exact mirror of the loss
    // this module removed, on the tab whose purpose is honesty.
    // computeUniverseRiskMetrics skips the interval instead; see the
    // "under any mark convention" pair below. Ruling 2026-08-01.
    expect(universeFlows('ons', inputs({ income: [coupon()] }))).toEqual([])
  })

  it('an ON coupon ENTERS measurable: a positive flow, not a gain', () => {
    // measurable is stocks + cash; the ONs that paid are outside it.
    expect(universeFlows('measurable', inputs({ income: [coupon()] }))).toEqual([
      { date: '2026-07-10', amount: 8300 },
    ])
  })

  it('an ON coupon is INTERNAL to total — both legs are inside it', () => {
    expect(universeFlows('total', inputs({ income: [coupon()] }))).toEqual([])
  })

  it('an ON coupon does not touch the stocks universe', () => {
    expect(universeFlows('stocks', inputs({ income: [coupon()] }))).toEqual([])
  })

  it('a stock dividend LEAVES the stocks universe', () => {
    expect(universeFlows('stocks', inputs({ income: [coupon({ type: 'DIVIDENDO', amount: 500 })] })))
      .toEqual([{ date: '2026-07-10', amount: -500 }])
  })

  it('a stock dividend is INTERNAL to measurable — the check that validates the table', () => {
    // Stocks down, cash up, and measurable contains both — exactly as a
    // stock PURCHASE declares nothing there. If this cell were wrong the
    // whole table would be wrong.
    expect(universeFlows('measurable', inputs({ income: [coupon({ type: 'DIVIDENDO', amount: 500 })] })))
      .toEqual([])
  })

  it('a stock dividend does not touch the ons universe', () => {
    expect(universeFlows('ons', inputs({ income: [coupon({ type: 'DIVIDENDO', amount: 500 })] })))
      .toEqual([])
  })

  it('takes the magnitude: a stored amount is unsigned, direction comes from the table', () => {
    // Asserted through `measurable`, the universe where a coupon is still a
    // flow. `ons` no longer declares one at all.
    expect(universeFlows('measurable', inputs({ income: [coupon({ amount: -8300 })] })))
      .toEqual([{ date: '2026-07-10', amount: 8300 }])
  })

  it('nets income with a same-day trade into ONE entry', () => {
    // ON purchase of 25,125 (out of measurable) and a coupon of 8,300 (into it).
    const flows = universeFlows('measurable', inputs({
      transactions: [tx({ asset_type: 'ON', quantity: 250, price: 100.5, commission: 0 })],
      income: [coupon()],
    }))
    expect(flows).toEqual([{ date: '2026-07-10', amount: -16825 }])
  })

  it('omits a date where income and a trade cancel exactly', () => {
    const flows = universeFlows('measurable', inputs({
      transactions: [tx({ asset_type: 'ON', quantity: 83, price: 100, commission: 0 })],
      income: [coupon()],
    }))
    expect(flows).toEqual([])
  })

  it('refuses a non-finite amount instead of poisoning the net', () => {
    expect(universeFlows('ons', inputs({ income: [coupon({ amount: NaN })] }))).toEqual([])
  })

  it('empty income changes nothing', () => {
    expect(universeFlows('ons', inputs({ income: [] }))).toEqual([])
    expect(universeFlows('measurable', inputs({ externalFlows: [{ date: '2026-07-01', amount: 21000 }] })))
      .toEqual([{ date: '2026-07-01', amount: 21000 }])
  })

  it('a CUPON transaction row produces NO trade flow — income is declared from cash_movements alone', () => {
    // Migration 035 made CUPON rows reachable in `transactions`. If tradeFlowAmount
    // ever interpreted one, measurable would net the trade flow against the income
    // flow to exactly zero and the fabricated gain would come back silently.
    expect(universeFlows('measurable', inputs({
      transactions: [tx({ operation: 'CUPON', asset_type: 'ON', quantity: 8300, price: 1 })],
    }))).toEqual([])
    expect(universeFlows('ons', inputs({
      transactions: [tx({ operation: 'CUPON', asset_type: 'ON', quantity: 8300, price: 1 })],
    }))).toEqual([])
  })
})

/** n daily points with alternating small moves so stdDev > 0. */
const wobble = (n: number, start = 1000): ProjectableSnapshot[] =>
  Array.from({ length: n }, (_, i) => {
    const day = String(i + 1).padStart(2, '0')
    const v = start + (i % 2 === 0 ? i : -i)
    return snap(`2026-06-${day}`, {
      total_value: v,
      stocks_value: v - 100,
      cash_value: 100,
      ons_value: 0,
      ons_invested: 0,
      source: 'live',
    })
  })

describe('metricsRows', () => {
  it('keeps every row for total/measurable/stocks', () => {
    const rows = [snap('2026-07-01', { source: 'estimated' }), snap('2026-07-02', { source: 'live' })]
    expect(metricsRows(rows, 'measurable')).toHaveLength(2)
    expect(metricsRows(rows, 'stocks')).toHaveLength(2)
  })

  it('keeps ONLY measured rows for ons — an estimated ons_value is a cost mark, not a measurement', () => {
    const rows = [snap('2026-07-01', { source: 'estimated' }), snap('2026-07-02', { source: 'live' })]
    expect(metricsRows(rows, 'ons')).toEqual([rows[1]])
  })

  it('a row with NO source counts as measured — migration 033 defaults source to live; never invent a third state', () => {
    const rows = [snap('2026-07-01'), snap('2026-07-02', { source: 'estimated' })]
    expect(metricsRows(rows, 'ons')).toEqual([rows[0]])
  })
})

describe('computeUniverseRiskMetrics — A3 thresholds', () => {
  it('21 points (20 intervals) clear the annualized threshold', () => {
    const m = computeUniverseRiskMetrics(wobble(21), 'measurable', inputs())
    expect(m.returnIntervals).toBe(MIN_INTERVALS_ANNUALIZED)
    expect(m.annualizedVol).not.toBeNull()
    expect(m.sharpeRatio).not.toBeNull()
    expect(m.maxDrawdown).not.toBeNull()
  })

  it('20 points (19 intervals) return null vol/Sharpe — never a number below threshold', () => {
    const m = computeUniverseRiskMetrics(wobble(20), 'measurable', inputs())
    expect(m.returnIntervals).toBe(19)
    expect(m.annualizedVol).toBeNull()
    expect(m.sharpeRatio).toBeNull()
    expect(m.maxDrawdown).not.toBeNull() // 19 ≥ 2
  })

  it('3 points: drawdown is a number over 2 intervals, vol/Sharpe are null', () => {
    const m = computeUniverseRiskMetrics(wobble(3), 'measurable', inputs())
    expect(m.maxDrawdown).not.toBeNull()
    expect(m.annualizedVol).toBeNull()
    expect(m.sharpeRatio).toBeNull()
  })

  it('2 points (1 interval): everything is null', () => {
    const m = computeUniverseRiskMetrics(wobble(2), 'measurable', inputs())
    expect(m.maxDrawdown).toBeNull()
    expect(m.annualizedVol).toBeNull()
    expect(m.sharpeRatio).toBeNull()
  })
})

describe('computeUniverseRiskMetrics — ons measured-only ruling', () => {
  it('computes ons metrics over live rows only; the flat estimated span is invisible to them', () => {
    const rows = [
      ...Array.from({ length: 30 }, (_, i) =>
        snap(`2026-05-${String(i + 1).padStart(2, '0')}`, {
          source: 'estimated',
          ons_value: 300, // frozen at cost — the fake calm
        })
      ),
      snap('2026-07-24', { source: 'live', ons_value: 320 }),
      snap('2026-07-25', { source: 'live', ons_value: 321 }),
      snap('2026-07-28', { source: 'live', ons_value: 319 }),
    ]
    const m = computeUniverseRiskMetrics(rows, 'ons', inputs())
    expect(m.pointsUsed).toBe(3) // 30 estimated rows excluded
    expect(m.returnIntervals).toBe(2)
    expect(m.annualizedVol).toBeNull() // 2 < 20 → Sin datos suficientes
    expect(m.sharpeRatio).toBeNull()
    expect(m.maxDrawdown).not.toBeNull() // 2 ≥ 2: a small, real number
  })

  it('stocks metrics DO use estimated rows — Yahoo-reconstructed marks are measurements', () => {
    const rows = wobble(21).map((r) => ({ ...r, source: 'estimated' as const }))
    const m = computeUniverseRiskMetrics(rows, 'stocks', inputs())
    expect(m.pointsUsed).toBe(21)
  })
})

describe('computeUniverseRiskMetrics — a coupon day is not measured in the ons universe', () => {
  /** Five live days. The coupon is paid on day 3. The ONLY difference between
   *  the two worlds is how the ON leg was MARKED that day, which the snapshot
   *  row does not record:
   *    priced  — the dirty price falls by the payment (ons_value 100k → 91.7k)
   *    at cost — no quote, so `missingQuotePolicy: 'avg_cost'` holds it flat,
   *              and the row still counts as live, so it still reaches here.
   *  A `−amount` flow is right in the first world and fabricates a +8.3% gain
   *  in the second. Skipping the interval is right in BOTH. */
  const COUPON_DAY = '2026-07-03'
  const onsSeries = (values: number[]) =>
    values.map((v, i) =>
      snap(`2026-07-${String(i + 1).padStart(2, '0')}`, { source: 'live', ons_value: v })
    )
  const priced = () => onsSeries([100000, 100000, 91700, 91700, 91700])
  const atCost = () => onsSeries([100000, 100000, 100000, 100000, 100000])
  const withCoupon = inputs({
    income: [{ date: COUPON_DAY, type: 'CUPON', amount: 8300 }],
  })

  it('gives the SAME metrics under either mark convention — the test the flow could not pass', () => {
    // If this ever fails, the coupon day is being interpreted again and the
    // at-cost world is fabricating a gain. Nothing else in the suite says so.
    expect(computeUniverseRiskMetrics(atCost(), 'ons', withCoupon)).toEqual(
      computeUniverseRiskMetrics(priced(), 'ons', withCoupon)
    )
  })

  it('fabricates no gain when the leg was held at cost', () => {
    const m = computeUniverseRiskMetrics(atCost(), 'ons', withCoupon)
    expect(m.maxDrawdown).toBe(0)
    expect(m.returnIntervals).toBe(3) // 4 intervals, the coupon's one skipped
    expect(m.drawdownIntervalsSkipped).toBe(1)
  })

  it('reads no loss when the leg was priced and the payment really left', () => {
    const m = computeUniverseRiskMetrics(priced(), 'ons', withCoupon)
    expect(m.maxDrawdown).toBe(0)
    expect(m.returnIntervals).toBe(3)
  })

  it('still measures a REAL fall that happens after the coupon', () => {
    // Skipping one day must not become a way of hiding risk: day 4 drops 10%
    // on its own and the drawdown has to report it.
    const rows = onsSeries([100000, 100000, 91700, 82530, 82530])
    const m = computeUniverseRiskMetrics(rows, 'ons', withCoupon)
    expect(m.maxDrawdown).toBeCloseTo(-0.1)
  })

  it('measures every interval when there is no coupon at all', () => {
    const m = computeUniverseRiskMetrics(atCost(), 'ons', inputs())
    expect(m.returnIntervals).toBe(4)
    expect(m.drawdownIntervalsSkipped).toBe(0)
  })

  it('skips NOTHING in measurable — there the coupon is still a declared inflow', () => {
    // measurable is stocks + cash and depends only on cash_value, which
    // genuinely rises on the payment date under ANY mark convention. The flow
    // is correct there, so the skip must not spread to it: every interval is
    // still measured, and the declared flow absorbs the jump.
    const rows = Array.from({ length: 5 }, (_, i) =>
      snap(`2026-07-0${i + 1}`, {
        source: 'live',
        stocks_value: 100000,
        cash_value: i >= 2 ? 28300 : 20000,
      })
    )
    const m = computeUniverseRiskMetrics(rows, 'measurable', withCoupon)
    expect(m.returnIntervals).toBe(4)
    expect(m.drawdownIntervalsSkipped).toBe(0)
    expect(m.maxDrawdown).toBe(0)
    // And the flow itself is untouched — the inflow is still declared.
    expect(universeFlows('measurable', withCoupon)).toEqual([
      { date: COUPON_DAY, amount: 8300 },
    ])
  })
})

describe('computeUniverseRiskMetrics — accounting', () => {
  it('counts rows dropped by the projection', () => {
    const rows = [...wobble(3), snap('2026-06-30', { stocks_value: null })]
    const m = computeUniverseRiskMetrics(rows, 'stocks', inputs())
    expect(m.pointsUsed).toBe(3)
    expect(m.pointsDropped).toBe(1)
  })

  it('a class flow is adjusted away: the +10,000 gain-that-isn\'t must not inflate volatility', () => {
    // 21 wobbling points, but day 11 jumps +10,000 because stock was BOUGHT.
    const rows = wobble(21).map((r, i) =>
      i >= 10
        ? { ...r, stocks_value: (r.stocks_value as number) + 10000 }
        : r
    )
    const jumpDate = rows[10].snapshot_date
    const noFlow = computeUniverseRiskMetrics(rows, 'stocks', inputs())
    const withFlow = computeUniverseRiskMetrics(rows, 'stocks', inputs({
      transactions: [
        { date: jumpDate, operation: 'COMPRA', quantity: 100, price: 100, commission: 0, asset_type: 'ACCION' },
      ],
    }))
    // Without the flow, the purchase day reads as a massive fake gain and
    // inflates volatility; with the flow declared, the series is calm.
    expect(noFlow.annualizedVol).not.toBeNull()
    expect(withFlow.annualizedVol).not.toBeNull()
    expect(withFlow.annualizedVol!).toBeLessThan(noFlow.annualizedVol!)
  })
})
