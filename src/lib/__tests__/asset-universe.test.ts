import { describe, it, expect } from 'vitest'
import {
  isUniverse,
  parseUniverse,
  projectHistory,
  projectSeries,
  universeFlows,
  computeUniverseRiskMetrics,
  computeUniverseTwr,
  MIN_INTERVALS_VOLATILITY,
  MIN_INTERVALS_SHARPE,
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
  pnl: 100, // 1000 − (800 cost + 100 cash)
  stocks_value: 600,
  stocks_invested: 500,
  ons_value: 300,
  ons_invested: 300,
  cash_value: 100,
  ...over,
})

describe('isUniverse', () => {
  it('accepts the three universes', () => {
    for (const u of ['total', 'stocks', 'ons']) {
      expect(isUniverse(u)).toBe(true)
    }
  })

  it('rejects anything else, the retired measurable included', () => {
    expect(isUniverse('measurable')).toBe(false)
    expect(isUniverse('cash')).toBe(false)
    expect(isUniverse('')).toBe(false)
    expect(isUniverse('TOTAL')).toBe(false)
  })
})

describe('parseUniverse', () => {
  it('defaults to the whole portfolio when the parameter is absent (S9)', () => {
    expect(parseUniverse(null)).toBe('total')
  })

  it('reads the retired measurable as the whole portfolio — old clients and cached URLs keep working', () => {
    expect(parseUniverse('measurable')).toBe('total')
  })

  it('keeps the class filters and refuses anything else', () => {
    expect(parseUniverse('stocks')).toBe('stocks')
    expect(parseUniverse('ons')).toBe('ons')
    expect(parseUniverse('total')).toBe('total')
    expect(parseUniverse('banana')).toBeNull()
    expect(parseUniverse('')).toBeNull()
  })
})

describe('projectHistory', () => {
  it('total invested is cost + cash, so value − invested is the open pnl, not idle cash', () => {
    const [p] = projectHistory([snap('2026-07-01')], 'total')
    expect(p).toEqual({ snapshot_date: '2026-07-01', value: 1000, invested: 900 })
    expect(p.value - p.invested).toBe(100) // the stored pnl
  })

  it('total uses pnl even when cash_value is null', () => {
    const [p] = projectHistory([snap('2026-07-01', { cash_value: null })], 'total')
    expect(p.invested).toBe(900)
  })

  it('stocks and ons project their own pair', () => {
    const [s] = projectHistory([snap('2026-07-01')], 'stocks')
    const [o] = projectHistory([snap('2026-07-01')], 'ons')
    expect([s.value, s.invested]).toEqual([600, 500])
    expect([o.value, o.invested]).toEqual([300, 300])
  })

  it('DROPS a null-breakdown row for stocks/ons but keeps it for total', () => {
    const rows = [
      snap('2026-07-01'),
      snap('2026-07-02', {
        stocks_value: null, stocks_invested: null,
        ons_value: null, ons_invested: null, cash_value: null,
      }),
    ]
    expect(projectHistory(rows, 'total')).toHaveLength(2)
    expect(projectHistory(rows, 'stocks')).toHaveLength(1)
    expect(projectHistory(rows, 'ons')).toHaveLength(1)
  })

  it('DROPS a row whose breakdown fields are absent (pre-034 row), never coerces to 0', () => {
    const bare: ProjectableSnapshot = {
      snapshot_date: '2026-07-03', total_value: 1000, total_invested: 800,
    }
    expect(projectHistory([bare], 'stocks')).toEqual([])
    expect(projectHistory([bare], 'ons')).toEqual([])
  })

  it('DROPS a non-finite value instead of letting it pass silently', () => {
    expect(projectHistory([snap('2026-07-04', { stocks_value: NaN })], 'stocks')).toEqual([])
    expect(projectHistory([snap('2026-07-04', { ons_value: Infinity })], 'ons')).toEqual([])
  })

  it('empty input returns empty, never throws', () => {
    expect(projectHistory([], 'total')).toEqual([])
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
    const [p] = projectSeries([snap('2026-07-01')], 'stocks')
    expect(p).toEqual({ snapshot_date: '2026-07-01', total_value: 600 })
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

  it('returns external flows unchanged for total', () => {
    expect(universeFlows('total', inputs({ externalFlows: external, transactions: [tx()] }))).toEqual(external)
  })

  it('total ignores the transaction list entirely — every trade is internal to it', () => {
    expect(universeFlows('total', inputs({
      transactions: [
        tx({ asset_type: 'ON', price: 100.5, quantity: 250 }),
        tx({ asset_type: 'ACCION' }),
      ],
    }))).toEqual([])
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
    // without TRIM). An unnormalized ' ON' matches NEITHER predicate and the
    // trade's flow would be dropped, so the comparison is normalized.
    for (const raw of [' ON', 'on', ' on ', 'On']) {
      expect(universeFlows('ons', inputs({ transactions: [tx({ asset_type: raw, quantity: 250, price: 100.5, commission: 0 })] })))
        .toEqual([{ date: '2026-07-10', amount: 25125 }])
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

  it('a stock dividend does not touch the ons universe', () => {
    expect(universeFlows('ons', inputs({ income: [coupon({ type: 'DIVIDENDO', amount: 500 })] })))
      .toEqual([])
  })

  it('takes the magnitude: a stored amount is unsigned, direction comes from the table', () => {
    // Asserted through `stocks`, where a dividend is a flow. `ons` declares
    // no coupon at all.
    expect(universeFlows('stocks', inputs({ income: [coupon({ type: 'DIVIDENDO', amount: -500 })] })))
      .toEqual([{ date: '2026-07-10', amount: -500 }])
  })

  it('nets income with a same-day trade into ONE entry', () => {
    // Stock purchase of 1,005 (into stocks) and a dividend of 500 (out of it).
    const flows = universeFlows('stocks', inputs({
      transactions: [tx()],
      income: [coupon({ type: 'DIVIDENDO', amount: 500 })],
    }))
    expect(flows).toEqual([{ date: '2026-07-10', amount: 505 }])
  })

  it('omits a date where income and a trade cancel exactly', () => {
    const flows = universeFlows('stocks', inputs({
      transactions: [tx({ quantity: 5, price: 100, commission: 0 })],
      income: [coupon({ type: 'DIVIDENDO', amount: 500 })],
    }))
    expect(flows).toEqual([])
  })

  it('refuses a non-finite amount instead of poisoning the net', () => {
    expect(universeFlows('ons', inputs({ income: [coupon({ amount: NaN })] }))).toEqual([])
  })

  it('empty income changes nothing', () => {
    expect(universeFlows('ons', inputs({ income: [] }))).toEqual([])
    expect(universeFlows('stocks', inputs({ income: [] }))).toEqual([])
  })

  it('a CUPON transaction row produces NO trade flow — income is declared from cash_movements alone', () => {
    // Migration 035 made CUPON rows reachable in `transactions`. If tradeFlowAmount
    // ever interpreted one, ons would read the payment as capital moving in.
    expect(universeFlows('ons', inputs({
      transactions: [tx({ operation: 'CUPON', asset_type: 'ON', quantity: 8300, price: 1 })],
    }))).toEqual([])
  })
})

/** The i-th day from 2026-06-01. */
const dateOf = (i: number) => new Date(Date.UTC(2026, 5, 1 + i)).toISOString().slice(0, 10)

/** n daily points with alternating small moves so stdDev > 0. */
const wobble = (n: number, start = 1000): ProjectableSnapshot[] =>
  Array.from({ length: n }, (_, i) => {
    const v = start + (i % 2 === 0 ? i : -i)
    return snap(dateOf(i), {
      total_value: v,
      stocks_value: v - 100,
      cash_value: 100,
      ons_value: 0,
      ons_invested: 0,
    })
  })

describe('computeUniverseRiskMetrics — minimum samples (S5)', () => {
  it('volatility needs 60 daily returns: 59 is null, 60 is a number, and Sharpe is still null', () => {
    expect(MIN_INTERVALS_VOLATILITY).toBe(60)
    const below = computeUniverseRiskMetrics(wobble(60), 'total', inputs())
    expect(below.returnIntervals).toBe(59)
    expect(below.annualizedVol).toBeNull()
    expect(below.maxDrawdown).not.toBeNull()

    const at = computeUniverseRiskMetrics(wobble(61), 'total', inputs())
    expect(at.returnIntervals).toBe(60)
    expect(at.annualizedVol).not.toBeNull()
    expect(at.sharpeRatio).toBeNull()
  })

  it('Sharpe needs 126 daily returns: 125 is null, 126 is a number', () => {
    expect(MIN_INTERVALS_SHARPE).toBe(126)
    const below = computeUniverseRiskMetrics(wobble(126), 'total', inputs())
    expect(below.returnIntervals).toBe(125)
    expect(below.sharpeRatio).toBeNull()
    expect(below.annualizedVol).not.toBeNull()

    const at = computeUniverseRiskMetrics(wobble(127), 'total', inputs())
    expect(at.returnIntervals).toBe(126)
    expect(at.sharpeRatio).not.toBeNull()
    expect(at.annualizedVol).not.toBeNull()
    expect(at.maxDrawdown).not.toBeNull()
  })

  it('the class universes get the same minimums', () => {
    const m = computeUniverseRiskMetrics(wobble(61), 'stocks', inputs())
    expect(m.returnIntervals).toBe(60)
    expect(m.annualizedVol).not.toBeNull()
    expect(m.sharpeRatio).toBeNull()
  })

  it('3 points: drawdown is a number over 2 intervals, vol/Sharpe are null', () => {
    const m = computeUniverseRiskMetrics(wobble(3), 'total', inputs())
    expect(m.maxDrawdown).not.toBeNull()
    expect(m.annualizedVol).toBeNull()
    expect(m.sharpeRatio).toBeNull()
  })

  it('2 points (1 interval): everything is null', () => {
    const m = computeUniverseRiskMetrics(wobble(2), 'total', inputs())
    expect(m.maxDrawdown).toBeNull()
    expect(m.annualizedVol).toBeNull()
    expect(m.sharpeRatio).toBeNull()
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
      snap(`2026-07-${String(i + 1).padStart(2, '0')}`, { ons_value: v })
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

  it('skips NOTHING in total and declares nothing — the ON leg and the cash leg are both inside (S9)', () => {
    // The ONs fall by the coupon and the cash rises by it on the same day, so
    // the whole portfolio does not move: no flow, no skipped interval, no gain.
    const rows = Array.from({ length: 5 }, (_, i) =>
      snap(`2026-07-0${i + 1}`, {
        total_value: 228300,
        ons_value: i >= 2 ? 91700 : 100000,
        cash_value: i >= 2 ? 28300 : 20000,
      })
    )
    const m = computeUniverseRiskMetrics(rows, 'total', withCoupon)
    expect(m.returnIntervals).toBe(4)
    expect(m.drawdownIntervalsSkipped).toBe(0)
    expect(m.maxDrawdown).toBe(0)
    expect(universeFlows('total', withCoupon)).toEqual([])
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
    // 61 wobbling points (60 returns, the volatility minimum), but day 31 jumps +10,000 because stock was BOUGHT.
    const rows = wobble(61).map((r, i) =>
      i >= 30
        ? { ...r, stocks_value: (r.stocks_value as number) + 10000 }
        : r
    )
    const jumpDate = rows[30].snapshot_date
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

describe('the whole portfolio is measured after its last negative-cash day (S4)', () => {
  /** Ten days; the recorded cash is negative on days 2 and 4 (deposits missing), positive after. */
  const rows = () => wobble(10).map((r, i) => (i === 1 || i === 3 ? { ...r, cash_value: -500 } : r))

  it('total starts the day after the last negative-cash day, and says from when and why', () => {
    const m = computeUniverseRiskMetrics(rows(), 'total', inputs())
    expect(m.measuredFrom).toBe(dateOf(4))
    expect(m.negativeCashUntil).toBe(dateOf(3))
    expect(m.unavailableReason).toBeNull()
    expect(m.pointsUsed).toBe(6)
    expect(m.pointsDropped).toBe(0)
    expect(m.returnIntervals).toBe(5)
    // The same figures as a series that never had those days.
    expect(m).toEqual({ ...computeUniverseRiskMetrics(rows().slice(4), 'total', inputs()), negativeCashUntil: dateOf(3) })
  })

  it('the TWR behind the benchmark comparison starts on the same day', () => {
    const twr = computeUniverseTwr(rows(), 'total', inputs())
    expect(twr.series[0].date).toBe(dateOf(4))
    expect(twr.measuredFrom).toBe(dateOf(4))
    expect(twr).toEqual({ ...computeUniverseTwr(rows().slice(4), 'total', inputs()), negativeCashUntil: dateOf(3) })
  })

  it('cash within the $1 tolerance is rounding, not a missing deposit', () => {
    const m = computeUniverseRiskMetrics(wobble(5).map((r, i) => (i === 3 ? { ...r, cash_value: -0.99 } : r)), 'total', inputs())
    expect(m.measuredFrom).toBe(dateOf(0))
    expect(m.negativeCashUntil).toBeNull()
    expect(m.pointsUsed).toBe(5)
  })

  it('with negative cash today nothing is measured, and the reason is given', () => {
    const today = wobble(30).map((r, i) => (i === 29 ? { ...r, cash_value: -10 } : r))
    const m = computeUniverseRiskMetrics(today, 'total', inputs())
    expect(m).toMatchObject({
      maxDrawdown: null, annualizedVol: null, sharpeRatio: null, returnIntervals: 0, pointsUsed: 0,
      measuredFrom: null, negativeCashUntil: dateOf(29), unavailableReason: 'negative_cash',
    })
    expect(computeUniverseTwr(today, 'total', inputs())).toMatchObject({ series: [], unavailableReason: 'negative_cash' })
  })

  it('stocks and ONs hold no cash: their series are never cut', () => {
    for (const universe of ['stocks', 'ons'] as const) {
      const m = computeUniverseRiskMetrics(rows(), universe, inputs())
      expect(m.pointsUsed).toBe(10)
      expect(m.measuredFrom).toBe(dateOf(0))
      expect(m.negativeCashUntil).toBeNull()
      expect(m.unavailableReason).toBeNull()
    }
  })
})
