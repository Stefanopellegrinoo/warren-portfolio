// S4 (odd/tasks/split-aware-ledger.md): a pre-split trade entered with split-adjusted numbers is
// refused, never on market data alone (no bar, Yahoo failing or no stored split: the write goes on).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { BarsResult } from '../bars-cache'

const h = vi.hoisted(() => ({
  splits: new Map<string, { date: string; numerator: number; denominator: number }[]>(),
  catalog: [] as { ticker: string; yahoo_symbol: string }[],
  catalogFails: false,
  bars: new Map<string, unknown>(),
  getBars: [] as Array<{ symbols: string[]; from: string }>,
}))
vi.mock('../stock-splits', () => ({ loadSplits: async () => h.splits }))
vi.mock('../ticker-catalog', async orig => ({
  ...(await orig<object>()),
  listCatalogued: async () => { if (h.catalogFails) throw new Error('catalog down'); return h.catalog },
}))
vi.mock('../bars-cache', () => ({
  getBars: async (symbols: string[], from: Date) => { h.getBars.push({ symbols, from: from.toISOString().slice(0, 10) }); return h.bars },
}))

import { splitAdjustedMessage, assertNotSplitAdjusted, SplitAdjustedError } from '../split-adjusted-check'

const GOOGL_SPLIT = [{ date: '2022-07-18', numerator: 20, denominator: 1 }]
const bars = (over: Partial<BarsResult> = {}): BarsResult => ({
  bars: [{ date: '2022-03-18', close: 140.123 }], splits: GOOGL_SPLIT, splitsKnown: true, degraded: false, missing: false, ...over,
})
const adjusted = { ticker: 'GOOGL', date: '2022-03-21', quantity: 17.93, price: 136.98 }
const GOOGL_MESSAGE = 'El precio de GOOGL el 2022-03-21 (136.98) parece ajustado por el split 20:1 del 2022-07-18: ese día cotizaba cerca de 2802.46. Cargala como figura en tu comprobante: 0.8965 a 2739.6.'

describe('splitAdjustedMessage (pure)', () => {
  it('a pre-split price closer to the adjusted close is refused with the exact message (one split)', () => {
    expect(splitAdjustedMessage(adjusted, GOOGL_SPLIT, bars())).toBe(GOOGL_MESSAGE)
  })

  it('names several splits with ", " between items and " y " before the last', () => {
    const nvda = [{ date: '2021-07-20', numerator: 4, denominator: 1 }, { date: '2024-06-10', numerator: 10, denominator: 1 }]
    const ref = { bars: [{ date: '2021-01-04', close: 13.08 }], splits: nvda, splitsKnown: true, degraded: false, missing: false }
    expect(splitAdjustedMessage({ ticker: 'NVDA', date: '2021-01-04', quantity: 40, price: 13.1 }, nvda, ref)).toBe(
      'El precio de NVDA el 2021-01-04 (13.1) parece ajustado por los splits 4:1 del 2021-07-20 y 10:1 del 2024-06-10: ese día cotizaba cerca de 523.2. Cargala como figura en tu comprobante: 1 a 524.')
    const three = [{ date: '2020-01-02', numerator: 2, denominator: 1 }, ...nvda]
    expect(splitAdjustedMessage({ ticker: 'NVDA', date: '2019-12-30', quantity: 80, price: 6.55 }, three, { ...ref, bars: [{ date: '2019-12-30', close: 6.54 }], splits: three }))
      .toBe('El precio de NVDA el 2019-12-30 (6.55) parece ajustado por los splits 2:1 del 2020-01-02, 4:1 del 2021-07-20 y 10:1 del 2024-06-10: ese día cotizaba cerca de 523.2. Cargala como figura en tu comprobante: 1 a 524.')
  })

  it('an as-traded price passes', () => {
    expect(splitAdjustedMessage({ ...adjusted, quantity: 0.8965, price: 2739.6 }, GOOGL_SPLIT, bars())).toBeNull()
  })

  it('a trade on or after the split date is already on the new basis: no split after it, no check', () => {
    expect(splitAdjustedMessage({ ...adjusted, date: '2022-07-18' }, GOOGL_SPLIT, bars({ bars: [{ date: '2022-07-18', close: 140.123 }] }))).toBeNull()
  })

  it('skips a factor between 1/1.5 and 1.5, checks 1.5 and its inverse', () => {
    const ratio = (numerator: number, denominator: number) => [{ date: '2022-07-18', numerator, denominator }]
    expect(splitAdjustedMessage(adjusted, ratio(5, 4), bars({ splits: ratio(5, 4) }))).toBeNull()
    expect(splitAdjustedMessage(adjusted, ratio(4, 5), bars({ splits: ratio(4, 5) }))).toBeNull()
    expect(splitAdjustedMessage({ ...adjusted, price: 140 }, ratio(3, 2), bars({ splits: ratio(3, 2) }))).toContain('parece ajustado por el split 3:2 del 2022-07-18')
    expect(splitAdjustedMessage({ ...adjusted, price: 140 }, ratio(2, 3), bars({ splits: ratio(2, 3) }))).toContain('parece ajustado por el split 2:3 del 2022-07-18')
  })

  it('takes the last bar on or before the date, at most 7 calendar days before; none: no check', () => {
    expect(splitAdjustedMessage(adjusted, GOOGL_SPLIT, bars({ bars: [{ date: '2022-03-14', close: 140.123 }, { date: '2022-03-22', close: 1 }] }))).toBe(GOOGL_MESSAGE)
    expect(splitAdjustedMessage(adjusted, GOOGL_SPLIT, bars({ bars: [{ date: '2022-03-13', close: 140.123 }, { date: '2022-03-22', close: 140.123 }] }))).toBeNull()
  })

  it('the real close uses the chart splits when Yahoo knows them, else the stored ones', () => {
    const chartTen = [{ date: '2022-07-18', numerator: 10, denominator: 1 }]
    expect(splitAdjustedMessage(adjusted, GOOGL_SPLIT, bars({ splits: chartTen }))).toContain('ese día cotizaba cerca de 1401.23.')
    expect(splitAdjustedMessage(adjusted, GOOGL_SPLIT, bars({ splits: [], splitsKnown: false }))).toBe(GOOGL_MESSAGE)
  })

  it('Yahoo failing (missing or stale bars) is no check', () => {
    expect(splitAdjustedMessage(adjusted, GOOGL_SPLIT, bars({ degraded: true }))).toBeNull()
    expect(splitAdjustedMessage(adjusted, GOOGL_SPLIT, { bars: [], splits: [], splitsKnown: false, degraded: true, missing: true })).toBeNull()
    expect(splitAdjustedMessage(adjusted, GOOGL_SPLIT, undefined)).toBeNull()
  })
})

describe('assertNotSplitAdjusted (market data never blocks a write)', () => {
  const trade = { ...adjusted, operation: 'COMPRA', assetType: 'ACCION' }

  beforeEach(() => {
    h.splits = new Map([['GOOGL', GOOGL_SPLIT]])
    h.catalog = [{ ticker: 'GOOGL', yahoo_symbol: 'GOOGL' }]
    h.catalogFails = false
    h.bars = new Map([['GOOGL', bars()]])
    h.getBars.length = 0
  })

  it('throws SplitAdjustedError (status 400) with the message, reading bars from 7 days before the trade', async () => {
    const err = await assertNotSplitAdjusted([{ ...trade, ticker: 'googl' }]).catch(e => e)
    expect(err).toBeInstanceOf(SplitAdjustedError)
    expect(err.status).toBe(400)
    expect(err.ticker).toBe('GOOGL')
    expect(err.message).toBe(GOOGL_MESSAGE)
    expect(h.getBars).toEqual([{ symbols: ['GOOGL'], from: '2022-03-14' }])
  })

  it('checks sales too', async () => {
    await expect(assertNotSplitAdjusted([{ ...trade, operation: 'VENTA' }])).rejects.toBeInstanceOf(SplitAdjustedError)
  })

  it('no stored split after the date: no market read at all', async () => {
    h.splits = new Map()
    await expect(assertNotSplitAdjusted([trade])).resolves.toBeUndefined()
    expect(h.getBars).toEqual([])
  })

  it('skips ONs, dividends and .BA symbols', async () => {
    await expect(assertNotSplitAdjusted([{ ...trade, assetType: 'ON' }, { ...trade, operation: 'DIVIDENDO' }])).resolves.toBeUndefined()
    h.catalog = [{ ticker: 'GOOGL', yahoo_symbol: 'GOOGL.BA' }]
    h.bars = new Map([['GOOGL.BA', bars()]])
    await expect(assertNotSplitAdjusted([trade])).resolves.toBeUndefined()
    expect(h.getBars).toEqual([])
  })

  it('a failing market read skips the check', async () => {
    h.catalogFails = true
    await expect(assertNotSplitAdjusted([trade])).resolves.toBeUndefined()
    h.catalogFails = false
    h.bars = new Map([['GOOGL', bars({ degraded: true })]])
    await expect(assertNotSplitAdjusted([trade])).resolves.toBeUndefined()
  })
})
