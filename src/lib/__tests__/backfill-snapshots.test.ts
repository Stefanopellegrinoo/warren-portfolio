// src/lib/__tests__/backfill-snapshots.test.ts
import { describe, it, expect } from 'vitest'
import { buildBackfillRows, marketDaysFrom } from '../backfill-snapshots'
import type { ReplayTransaction } from '../portfolio-replay'
import type { DailyBar } from '../historical-prices'

function tx(over: Partial<ReplayTransaction>): ReplayTransaction {
  return {
    ticker: 'AAPL',
    operation: 'COMPRA',
    quantity: 10,
    price: 100,
    commission: 0,
    date: '2022-02-09',
    asset_type: 'ACCION',
    created_at: null,
    ...over,
  }
}

const bars = (rows: Array<[string, number]>): DailyBar[] =>
  rows.map(([date, close]) => ({ date, close }))

describe('marketDaysFrom', () => {
  it('is the sorted union of every bar date inside the range', () => {
    const days = marketDaysFrom(
      new Map([
        ['AAPL', bars([['2022-02-09', 1], ['2022-02-11', 1]])],
        ['MELI', bars([['2022-02-10', 1], ['2022-02-11', 1]])],
      ]),
      '2022-02-09',
      '2022-02-10'
    )

    expect(days).toEqual(['2022-02-09', '2022-02-10'])
  })

  it('returns an empty list when no bars fall in the range', () => {
    expect(marketDaysFrom(new Map([['AAPL', bars([['2021-01-01', 1]])]]), '2022-01-01', '2022-06-01')).toEqual([])
  })
})

describe('buildBackfillRows', () => {
  const baseInput = {
    userId: 'u1',
    transactions: [tx({ quantity: 10, price: 100, date: '2022-02-09' })],
    movements: [{ type: 'DEPOSITO', amount: 5000, date: '2022-02-01' }, { type: 'COMPRA', amount: 1000, date: '2022-02-09' }],
    dates: ['2022-02-09', '2022-02-10'],
    barsByTicker: new Map([['AAPL', bars([['2022-02-09', 110], ['2022-02-10', 120]])]]),
  }

  it('produces one row per requested day, all marked estimated', () => {
    const days = buildBackfillRows(baseInput)

    expect(days).toHaveLength(2)
    expect(days.every(d => d.row.source === 'estimated')).toBe(true)
    expect(days.map(d => d.row.snapshot_date)).toEqual(['2022-02-09', '2022-02-10'])
  })

  it('values the position at that day close plus cash', () => {
    const days = buildBackfillRows(baseInput)

    // day 1: 10 shares * 110 + cash (5000 - 1000) = 1100 + 4000
    expect(days[0].row.total_value).toBeCloseTo(5100, 6)
    expect(days[0].row.total_invested).toBeCloseTo(1000, 6)
    expect(days[0].row.pnl).toBeCloseTo(100, 6)
    // day 2: 10 * 120 + 4000
    expect(days[1].row.total_value).toBeCloseTo(5200, 6)
  })

  it('values a position with no bar at avg_cost, NEVER at zero', () => {
    // H4 failure mode 3. A zero here burns a permanent fake crash into the
    // drawdown series.
    const days = buildBackfillRows({
      ...baseInput,
      dates: ['2022-02-09'],
      barsByTicker: new Map(),
    })

    // 10 shares marked at cost 100 = 1000, plus 4000 cash
    expect(days[0].row.total_value).toBeCloseTo(5000, 6)
    expect(days[0].row.pnl).toBeCloseTo(0, 6)
    expect(days[0].unpricedTickers).toEqual(['AAPL'])
  })

  it('values a position on days BEFORE its ticker had bars, at cost', () => {
    // An ETF that started trading later must not read as a crash on the days
    // the user already held it (closeOnOrBefore returns null, not 0).
    const days = buildBackfillRows({
      ...baseInput,
      dates: ['2022-02-09'],
      barsByTicker: new Map([['AAPL', bars([['2022-03-01', 110]])]]),
    })

    expect(days[0].row.total_value).toBeCloseTo(5000, 6)
    expect(days[0].unpricedTickers).toEqual(['AAPL'])
  })

  it('includes a position that was later sold on the days it was held', () => {
    // H4 failure mode 1: survivorship. No activeTickers filter anywhere.
    const days = buildBackfillRows({
      userId: 'u1',
      transactions: [
        tx({ ticker: 'GONE', quantity: 10, price: 100, date: '2022-02-09' }),
        tx({ ticker: 'GONE', operation: 'VENTA', quantity: 10, price: 150, date: '2023-01-05' }),
      ],
      movements: [],
      dates: ['2022-06-01'],
      barsByTicker: new Map([['GONE', bars([['2022-06-01', 130]])]]),
    })

    expect(days[0].row.total_value).toBeCloseTo(1300, 6)
  })

  it('includes ONs and cash in total_value', () => {
    // H4 failure mode 2.
    const days = buildBackfillRows({
      userId: 'u1',
      transactions: [tx({ ticker: 'MGCRD', asset_type: 'ON', quantity: 100, price: 95, date: '2022-02-09' })],
      movements: [{ type: 'DEPOSITO', amount: 500, date: '2022-02-01' }],
      dates: ['2022-02-09'],
      barsByTicker: new Map(),
    })

    // ONs have no historical source: marked at cost 95 * 100 = 9500, plus 500 cash
    expect(days[0].row.total_value).toBeCloseTo(10000, 6)
    expect(days[0].row.total_invested).toBeCloseTo(9500, 6)
  })

  it('reports a day with no holdings as cash only', () => {
    const days = buildBackfillRows({
      userId: 'u1',
      transactions: [],
      movements: [{ type: 'DEPOSITO', amount: 750, date: '2022-02-01' }],
      dates: ['2022-02-09'],
      barsByTicker: new Map(),
    })

    expect(days[0].row.total_value).toBeCloseTo(750, 6)
    expect(days[0].row.total_invested).toBe(0)
    expect(days[0].row.pnl).toBe(0)
  })

  it('carries the last close forward across a market holiday', () => {
    const days = buildBackfillRows({
      ...baseInput,
      dates: ['2022-02-12'],
      barsByTicker: new Map([['AAPL', bars([['2022-02-11', 130]])]]),
    })

    expect(days[0].row.total_value).toBeCloseTo(1300 + 4000, 6)
    expect(days[0].unpricedTickers).toEqual([])
  })

  it('stamps the user id on every row', () => {
    expect(buildBackfillRows(baseInput).every(d => d.row.user_id === 'u1')).toBe(true)
  })

  it('reports every ticker HELD that day, priced or not, stocks then ONs', () => {
    // The denominator for the dry-run report. "50 of 1120 days" for a ticker
    // held 50 days reads as a 4% problem when it is a 100% pricing failure for
    // that position's entire life — and few tickers are held the full range, so
    // the total-days denominator understates severity on nearly every line.
    const days = buildBackfillRows({
      userId: 'u1',
      transactions: [
        tx({ ticker: 'AAPL', quantity: 10, price: 100, commission: 0, date: '2022-02-09' }),
        tx({ ticker: 'MGCRD', asset_type: 'ON', quantity: 100, price: 95, commission: 0, date: '2022-02-09' }),
        tx({ ticker: 'MELI', quantity: 5, price: 200, commission: 0, date: '2022-02-10' }),
      ],
      movements: [],
      dates: ['2022-02-09', '2022-02-10'],
      // Only AAPL has bars: MELI and the ON are unpriced but still HELD.
      barsByTicker: new Map([['AAPL', bars([['2022-02-09', 110], ['2022-02-10', 120]])]]),
    })

    expect(days[0].heldTickers).toEqual(['AAPL', 'MGCRD'])
    expect(days[1].heldTickers).toEqual(['AAPL', 'MELI', 'MGCRD'])
    // A priced ticker is HELD but not UNPRICED — the two lists differ on purpose.
    expect(days[1].unpricedTickers).toEqual(['MELI', 'MGCRD'])
  })

  it('omits a ticker from heldTickers on days before it was bought and after it was sold', () => {
    const days = buildBackfillRows({
      userId: 'u1',
      transactions: [
        tx({ ticker: 'GONE', quantity: 10, price: 100, commission: 0, date: '2022-02-10' }),
        tx({ ticker: 'GONE', operation: 'VENTA', quantity: 10, price: 150, date: '2022-02-11' }),
      ],
      movements: [],
      dates: ['2022-02-09', '2022-02-10', '2022-02-11'],
      barsByTicker: new Map([['GONE', bars([['2022-02-10', 110]])]]),
    })

    expect(days.map(d => d.heldTickers)).toEqual([[], ['GONE'], []])
  })

  it('REFUSES to emit a row where a position would vanish from both value and invested', () => {
    // No price AND no usable cost means applyCostFallback drops it from
    // total_value and total_invested together. Emitting a silently-short row
    // would read as a drop and then a recovery in the drawdown series.
    expect(() =>
      buildBackfillRows({
        userId: 'u1',
        transactions: [tx({ ticker: 'FREE', quantity: 10, price: 0, commission: 0, date: '2022-02-09' })],
        movements: [],
        dates: ['2022-02-09'],
        barsByTicker: new Map(),
      })
    ).toThrow(/FREE/)
  })

  it('finds bars when the CALLER keyed the map with an unnormalized ticker', () => {
    // The position ticker is always normalized, so the mismatch can only be on
    // the map's side. A miss flattens the entire series to cost, silently.
    const days = buildBackfillRows({
      userId: 'u1',
      transactions: [tx({ ticker: 'AAPL', quantity: 10, price: 100, commission: 0, date: '2022-02-09' })],
      movements: [],
      dates: ['2022-02-09'],
      barsByTicker: new Map([[' aapl ', bars([['2022-02-09', 110]])]]),
    })

    expect(days[0].row.total_value).toBeCloseTo(1100, 6)
    expect(days[0].unpricedTickers).toEqual([])
  })
})

describe('buildBackfillRows — a narrower range floor never truncates the replay', () => {
  // This is the property scripts/backfill-snapshots.ts's --from flag depends
  // on: --from narrows which DAYS get a row (via marketDaysFrom's `from`
  // bound and the bar-fetch window), never which transactions feed the
  // replay. A position bought before the floor must still be valued
  // correctly — at its FULL accumulated cost basis — on every day inside the
  // narrowed window. If the script ever filtered `transactions` by --from
  // instead of only `dates`, this would fail by showing the position at a
  // fraction of its real size instead of the whole thing.
  it('values a position bought entirely BEFORE the range floor at its full accumulated size', () => {
    const transactions = [
      tx({ ticker: 'AAPL', quantity: 10, price: 100, commission: 0, date: '2022-02-09' }), // long before the floor
      tx({ ticker: 'AAPL', quantity: 5, price: 120, commission: 0, date: '2026-04-05' }), // still before the floor
    ]
    const movements = [
      { type: 'DEPOSITO', amount: 5000, date: '2022-02-01' },
      { type: 'COMPRA', amount: 1000, date: '2022-02-09' },
      { type: 'COMPRA', amount: 600, date: '2026-04-05' },
    ]
    // Bars only exist from the floor onward — exactly what
    // fetchDailyBars(symbol, new Date(rangeStart), new Date()) would fetch
    // once --from moves the bar-fetch window forward.
    const barsByTicker = new Map([['AAPL', bars([['2026-04-10', 130], ['2026-04-13', 135]])]])

    // marketDaysFrom with a `from` bound AFTER both purchases — the exact
    // shape the script produces when --from is passed.
    const dates = marketDaysFrom(barsByTicker, '2026-04-10', '2026-04-13')
    expect(dates).toEqual(['2026-04-10', '2026-04-13'])

    const days = buildBackfillRows({ userId: 'u1', transactions, movements, dates, barsByTicker })

    // 15 shares (10 + 5), not 5 — the pre-floor purchase must still count.
    // cash = 5000 - 1000 - 600 = 3400.
    expect(days[0].row.total_invested).toBeCloseTo(1600, 6)
    expect(days[0].row.total_value).toBeCloseTo(15 * 130 + 3400, 6)
    expect(days[1].row.total_value).toBeCloseTo(15 * 135 + 3400, 6)
    expect(days[0].unpricedTickers).toEqual([])
  })
})

describe('buildBackfillRows — the funding-side guard', () => {
  /**
   * A ledger holding the buys but not the deposits that funded them replays
   * every COMPRA as a debit with nothing crediting it, so the two legs cancel
   * and total_value degenerates into cumulative P&L on a near-zero base.
   * Nothing downstream catches it: computeFlowAdjustedReturns only gaps an
   * interval whose startValue is <= 0, and a series hovering at a few hundred
   * dollars is positive; the per-user gate validates TODAY, which reconciles.
   */
  const unfunded = {
    userId: 'u1',
    transactions: [tx({ ticker: 'AAPL', quantity: 10, price: 100, commission: 0, date: '2022-02-09' })],
    // The COMPRA debit is there; the DEPOSITO that paid for it is not.
    movements: [{ type: 'COMPRA', amount: 1000, date: '2022-02-09' }],
    dates: ['2022-02-09', '2022-02-10'],
    barsByTicker: new Map([['AAPL', bars([['2022-02-09', 110], ['2022-02-10', 120]])]]),
  }

  it('builds a normally-funded history without complaint', () => {
    const days = buildBackfillRows({
      ...unfunded,
      movements: [
        { type: 'DEPOSITO', amount: 5000, date: '2022-02-01' },
        { type: 'COMPRA', amount: 1000, date: '2022-02-09' },
      ],
    })

    expect(days).toHaveLength(2)
  })

  it('tolerates a rounding cent below zero', () => {
    // numeric(18,4) rounds on every write; a fully-invested day can land a
    // hair under zero legitimately. That must not abort a 1120-day build.
    const days = buildBackfillRows({
      ...unfunded,
      movements: [
        { type: 'DEPOSITO', amount: 999.99, date: '2022-02-01' },
        { type: 'COMPRA', amount: 1000, date: '2022-02-09' },
      ],
    })

    expect(days).toHaveLength(2)
  })

  it('REFUSES the whole build when replayed cash goes materially negative, naming the day', () => {
    expect(() => buildBackfillRows(unfunded)).toThrow(/2022-02-09/)
    expect(() => buildBackfillRows(unfunded)).toThrow(/-1000\.00/)
    expect(() => buildBackfillRows(unfunded)).toThrow(/funded/i)
  })

  it('names the WORST negative, not the first one', () => {
    const days = {
      ...unfunded,
      transactions: [
        tx({ ticker: 'AAPL', quantity: 10, price: 100, commission: 0, date: '2022-02-09' }),
        tx({ ticker: 'AAPL', quantity: 10, price: 100, commission: 0, date: '2022-02-10' }),
      ],
      movements: [
        { type: 'COMPRA', amount: 1000, date: '2022-02-09' },
        { type: 'COMPRA', amount: 4000, date: '2022-02-10' },
      ],
    }

    expect(() => buildBackfillRows(days)).toThrow(/2022-02-10/)
    expect(() => buildBackfillRows(days)).toThrow(/-5000\.00/)
  })

  it('lets the maintainer override it after reading the message', () => {
    const days = buildBackfillRows({ ...unfunded, allowNegativeCash: true })

    expect(days).toHaveLength(2)
    // day 1: 10 * 110 + (-1000) cash
    expect(days[0].row.total_value).toBeCloseTo(100, 6)
  })
})
