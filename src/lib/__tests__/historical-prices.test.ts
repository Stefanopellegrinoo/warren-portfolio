// src/lib/__tests__/historical-prices.test.ts
import { describe, it, expect } from 'vitest'
import {
  fetchDailyBars,
  closeOnOrBefore,
  buildQuoteMap,
  HistoricalFetchError,
  fetchDailyChart,
  unadjustSplits,
  toUsd,
} from '../historical-prices'

const from = new Date('2022-02-09')
const to = new Date('2022-02-15')

/** A fake yahoo-finance2 instance: chart() and historical() are scripted. */
function fakeYahoo(script: { chart?: () => any; historical?: () => any }) {
  return async () => ({
    chart: script.chart ?? (() => { throw new Error('chart not scripted') }),
    historical: script.historical ?? (() => { throw new Error('historical not scripted') }),
  })
}

describe('fetchDailyBars', () => {
  it('returns normalized bars from the chart endpoint', async () => {
    const getYahoo = fakeYahoo({
      chart: () => ({
        quotes: [
          { date: new Date('2022-02-09T00:00:00Z'), close: 10.5 },
          { date: new Date('2022-02-10T00:00:00Z'), close: 11 },
        ],
      }),
    })

    const bars = await fetchDailyBars('AAPL', from, to, { getYahoo })

    expect(bars).toEqual([
      { date: '2022-02-09', close: 10.5 },
      { date: '2022-02-10', close: 11 },
    ])
  })

  it('falls back to the legacy endpoint when chart returns nothing', async () => {
    const getYahoo = fakeYahoo({
      chart: () => ({ quotes: [] }),
      historical: () => [{ date: new Date('2022-02-09T00:00:00Z'), close: 42 }],
    })

    const bars = await fetchDailyBars('AAPL', from, to, { getYahoo })

    expect(bars).toEqual([{ date: '2022-02-09', close: 42 }])
  })

  it('returns empty when Yahoo genuinely has no bars for the symbol', async () => {
    const getYahoo = fakeYahoo({ chart: () => ({ quotes: [] }), historical: () => [] })

    await expect(fetchDailyBars('NOSUCH', from, to, { getYahoo })).resolves.toEqual([])
  })

  it('W2b: [] after a chart() failure keeps splitsKnown=false; [] after a clean chart() is a fact', async () => {
    const failed = fakeYahoo({ chart: () => { throw new Error('429') }, historical: () => [] })
    await expect(fetchDailyChart('AAA', from, to, { getYahoo: failed })).resolves.toMatchObject({ bars: [], splitsKnown: false })
    const clean = fakeYahoo({ chart: () => ({ quotes: [] }), historical: () => [] })
    await expect(fetchDailyChart('AAA', from, to, { getYahoo: clean })).resolves.toMatchObject({ bars: [], splitsKnown: true })
  })

  it('THROWS when both endpoints fail — a fetch failure is not "no price"', async () => {
    // This is the whole point of the module. fetchHistoricalQuotes returns []
    // here, which the backfill would read as "unpriced" and mark at avg_cost,
    // fossilising an invented flat line.
    const getYahoo = fakeYahoo({
      chart: () => { throw new Error('Too Many Requests') },
      historical: () => { throw new Error('Too Many Requests') },
    })

    await expect(fetchDailyBars('AAPL', from, to, { getYahoo })).rejects.toThrow(HistoricalFetchError)
  })

  it('names the symbol in the thrown error', async () => {
    const getYahoo = fakeYahoo({
      chart: () => { throw new Error('boom') },
      historical: () => { throw new Error('boom') },
    })

    await expect(fetchDailyBars('MELI', from, to, { getYahoo })).rejects.toThrow(/MELI/)
  })

  it('drops bars with a null close rather than treating them as zero', async () => {
    const getYahoo = fakeYahoo({
      chart: () => ({
        quotes: [
          { date: new Date('2022-02-09T00:00:00Z'), close: null },
          { date: new Date('2022-02-10T00:00:00Z'), close: 11 },
        ],
      }),
    })

    await expect(fetchDailyBars('AAPL', from, to, { getYahoo })).resolves.toEqual([
      { date: '2022-02-10', close: 11 },
    ])
  })

  it('falls back to the legacy endpoint when chart returns bars with no usable close', async () => {
    // A non-empty response whose closes are all null is not evidence that
    // Yahoo has no data — [] must keep meaning exactly one thing.
    const getYahoo = fakeYahoo({
      chart: () => ({ quotes: [{ date: new Date('2022-02-09T00:00:00Z'), close: null }] }),
      historical: () => [{ date: new Date('2022-02-09T00:00:00Z'), close: 42 }],
    })

    await expect(fetchDailyBars('AAPL', from, to, { getYahoo })).resolves.toEqual([
      { date: '2022-02-09', close: 42 },
    ])
  })

  it('recovers through the legacy endpoint when chart throws', async () => {
    const getYahoo = fakeYahoo({
      chart: () => { throw new Error('Too Many Requests') },
      historical: () => [{ date: new Date('2022-02-09T00:00:00Z'), close: 42 }],
    })

    await expect(fetchDailyBars('AAPL', from, to, { getYahoo })).resolves.toEqual([
      { date: '2022-02-09', close: 42 },
    ])
  })
})

describe('closeOnOrBefore', () => {
  const bars = [
    { date: '2022-02-09', close: 10 },
    { date: '2022-02-11', close: 12 },
  ]

  it('returns the close of the exact day when it exists', () => {
    expect(closeOnOrBefore(bars, '2022-02-11')).toBe(12)
  })

  it('carries the last close forward across a weekend or holiday', () => {
    expect(closeOnOrBefore(bars, '2022-02-10')).toBe(10)
    expect(closeOnOrBefore(bars, '2022-02-20')).toBe(12)
  })

  it('returns null before the series starts — never a zero', () => {
    // A zero here would report a -100% crash for every day before the ETF existed.
    expect(closeOnOrBefore(bars, '2022-02-08')).toBeNull()
  })

  it('returns null for an empty series', () => {
    expect(closeOnOrBefore([], '2022-02-09')).toBeNull()
  })
})

describe('buildQuoteMap', () => {
  it('wraps prices in the Quote shape with zeroed day change', () => {
    const quotes = buildQuoteMap(new Map([['AAPL', 10.5]]))

    expect(quotes.get('AAPL')).toEqual({
      ticker: 'AAPL',
      price: 10.5,
      change: 0,
      changePercent: 0,
      previousClose: 10.5,
    })
  })

  it('omits a non-positive price so the cost fallback catches it', () => {
    // applyCostFallback treats price <= 0 as unpriced; emitting it would be
    // equivalent, but omitting keeps the map honest about what was priced.
    const quotes = buildQuoteMap(new Map([['AAPL', 0], ['MELI', -1]]))

    expect(quotes.size).toBe(0)
  })
})

describe('unadjustSplits', () => {
  const split = { date: '2024-06-10', numerator: 2, denominator: 1 }

  it('multiplies bars dated before the split by the ratio and leaves later bars untouched', () => {
    const out = unadjustSplits(
      [{ date: '2024-06-07', close: 50 }, { date: '2024-06-10', close: 60 }, { date: '2024-06-11', close: 61 }],
      [split]
    )
    expect(out).toEqual([
      { date: '2024-06-07', close: 100 },
      { date: '2024-06-10', close: 60 },
      { date: '2024-06-11', close: 61 },
    ])
  })

  it('compounds several splits that happened after the bar', () => {
    const out = unadjustSplits([{ date: '2020-01-02', close: 10 }], [split, { date: '2022-01-03', numerator: 3, denominator: 1 }])
    expect(out[0].close).toBeCloseTo(60, 10)
  })

  it('returns the bars untouched when there are no splits', () => {
    const bars = [{ date: '2024-06-07', close: 50 }]
    expect(unadjustSplits(bars, [])).toEqual(bars)
  })
})

describe('toUsd', () => {
  const bar = (date: string, close: number) => ({ date, close })

  it('divides an ARS close by the CCL of that day', () => {
    const out = toUsd([bar('2024-03-04', 12000)], new Map([['2024-03-04', 1200]]))
    expect(out).toEqual({ bars: [bar('2024-03-04', 10)], degraded: false })
  })

  it('carries the last CCL forward over a day without a rate', () => {
    const out = toUsd([bar('2024-03-05', 12000)], new Map([['2024-03-04', 1200]]))
    expect(out).toEqual({ bars: [bar('2024-03-05', 10)], degraded: false })
  })

  it('drops the bar and flags degraded when no CCL exists on or before the day', () => {
    const out = toUsd([bar('2024-03-01', 12000), bar('2024-03-05', 12000)], new Map([['2024-03-04', 1200]]))
    expect(out).toEqual({ bars: [bar('2024-03-05', 10)], degraded: true })
  })
})

describe('fetchDailyChart', () => {
  it('returns bars plus the split events from chart()', async () => {
    const getYahoo = fakeYahoo({
      chart: () => ({
        quotes: [{ date: new Date('2024-06-07T00:00:00Z'), close: 120 }],
        events: { splits: [{ date: new Date('2024-06-10T13:30:00Z'), numerator: 10, denominator: 1 }] },
      }),
    })
    const res = await fetchDailyChart('NVDA', from, to, { getYahoo })
    expect(res).toEqual({
      bars: [{ date: '2024-06-07', close: 120 }],
      splits: [{ date: '2024-06-10', numerator: 10, denominator: 1 }],
      splitsKnown: true,
    })
  })

  it('reports splitsKnown=false when only the legacy endpoint answered', async () => {
    const getYahoo = fakeYahoo({
      chart: () => ({ quotes: [] }),
      historical: () => [{ date: new Date('2024-06-07T00:00:00Z'), close: 120 }],
    })
    const res = await fetchDailyChart('NVDA', from, to, { getYahoo })
    expect(res.splitsKnown).toBe(false)
    expect(res.splits).toEqual([])
    expect(res.bars).toHaveLength(1)
  })

  it('fetchDailyBars still returns just the bars', async () => {
    const getYahoo = fakeYahoo({ chart: () => ({ quotes: [{ date: new Date('2024-06-07T00:00:00Z'), close: 120 }] }) })
    expect(await fetchDailyBars('NVDA', from, to, { getYahoo })).toEqual([{ date: '2024-06-07', close: 120 }])
  })
})
