import { describe, it, expect } from 'vitest'
import type { MarketBoard } from './market-board'
import {
  DEFAULT_SORT, dayChange, filterRows, inCurrency, listRows, marketRows, pageRows, parseView, serializeView, sortRows, type ViewRow,
} from './market-view'

// Invented prices and names: no real portfolio data.
const board: MarketBoard = {
  lider: [
    { symbol: 'GGAL', name: 'Grupo Galicia', price: 6000, changePct: 0.034 },
    { symbol: 'GFVA', name: null, price: null, changePct: null },
    { symbol: 'PAMP', name: 'Pampa Energía', price: 4000, changePct: -0.008 },
  ],
  locals: [
    { symbol: 'GGAL', name: 'Grupo Galicia', price: 6000, changePct: 0.034 },
    { symbol: 'PAMP', name: 'Pampa Energía', price: 4000, changePct: -0.008 },
    { symbol: 'HARG', name: 'Holcim Argentina', price: 2000, changePct: 0.01 },
  ],
  cedears: [
    { symbol: 'AAPL', name: 'Apple', price: 15000, changePct: 0.012 },
    { symbol: 'AMD', name: null, price: 9000, changePct: -0.02 },
  ],
  fx: { mep: 1500, ccl: 1600 },
  marketOpen: true,
  updatedAt: '2026-10-30T15:00:00.000Z',
}

const tickers = (rows: ViewRow[]) => rows.map((r) => r.ticker)
const row = (ticker: string, price: number | null, changePct: number | null): ViewRow =>
  ({ key: ticker, ticker, stored: ticker, name: null, price, changePct, note: null, line: null })

describe('marketRows', () => {
  it('the Panel líder rows link and store a local share as BCBA:X, a member without a price included', () => {
    const rows = marketRows(board, 'lider')
    expect(tickers(rows)).toEqual(['GGAL', 'GFVA', 'PAMP'])
    expect(rows[0]).toMatchObject({ stored: 'BCBA:GGAL', name: 'Grupo Galicia', price: 6000, changePct: 0.034, note: null, line: { kind: 'local', line: 'GGAL' } })
    expect(rows[1]).toMatchObject({ price: null, changePct: null })
  })

  it('a CEDEAR row stores and links its plain ticker', () => {
    expect(marketRows(board, 'cedears')[0]).toMatchObject({ ticker: 'AAPL', stored: 'AAPL', line: { kind: 'cedear', line: 'AAPL' } })
  })
})

describe('listRows', () => {
  it('prices each stored symbol with its BYMA peso line: CEDEAR, local share and a panel general share', () => {
    const rows = listRows(['AAPL', 'BCBA:PAMP', 'HARG.BA'], board)
    expect(rows.map((r) => [r.ticker, r.stored, r.price])).toEqual([['AAPL', 'AAPL', 15000], ['PAMP', 'BCBA:PAMP', 4000], ['HARG', 'BCBA:HARG', 2000]])
  })

  it('shows two spellings of the same share once', () => {
    expect(tickers(listRows(['GGAL.BA', 'BCBA:GGAL'], board))).toEqual(['GGAL'])
  })

  it('never prices a US ADR at the local share’s price, and says why', () => {
    const [row] = listRows(['GGAL'], board)
    expect(row).toMatchObject({ ticker: 'GGAL', stored: 'GGAL', price: null, changePct: null, note: 'ADR en EE.UU., no cotiza en BYMA', line: null })
  })

  it('keeps what does not trade on BYMA, with a note, so the list matches Gráficos', () => {
    const [row] = listRows(['BTCUSDT'], board)
    expect(row).toMatchObject({ ticker: 'BTCUSDT', stored: 'BTCUSDT', price: null, note: 'No cotiza en BYMA', line: null })
  })
})

describe('inCurrency', () => {
  it('pesos as they are; MEP and cable divide by the day’s rate', () => {
    expect(inCurrency(3000, 'ARS', board.fx)).toBe(3000)
    expect(inCurrency(3000, 'MEP', board.fx)).toBe(2)
    expect(inCurrency(3200, 'CCL', board.fx)).toBe(2)
  })

  it('no price, or no rate, is no number', () => {
    expect(inCurrency(null, 'MEP', board.fx)).toBeNull()
    expect(inCurrency(3000, 'MEP', { mep: null, ccl: 1600 })).toBeNull()
  })
})

describe('sortRows', () => {
  const rows = marketRows(board, 'lider')

  it('by default the day’s best first, rows without a value last', () => {
    expect(tickers(sortRows(rows, DEFAULT_SORT))).toEqual(['GGAL', 'PAMP', 'GFVA'])
  })

  it('rows without a value stay last in either direction', () => {
    expect(tickers(sortRows(rows, { key: 'change', dir: 'asc' }))).toEqual(['PAMP', 'GGAL', 'GFVA'])
    expect(tickers(sortRows(rows, { key: 'price', dir: 'asc' }))).toEqual(['PAMP', 'GGAL', 'GFVA'])
  })

  it('by ticker, A to Z', () => {
    expect(tickers(sortRows(rows, { key: 'ticker', dir: 'asc' }))).toEqual(['GFVA', 'GGAL', 'PAMP'])
  })

  it('by today’s change in money, not in percent, rows without a value last in either direction', () => {
    const rows = [row('SMALL', 100, 0.1), row('NONE', null, null), row('BIG', 10000, 0.01)]
    expect(tickers(sortRows(rows, { key: 'abs', dir: 'desc' }))).toEqual(['BIG', 'SMALL', 'NONE'])
    expect(tickers(sortRows(rows, { key: 'abs', dir: 'asc' }))).toEqual(['SMALL', 'BIG', 'NONE'])
  })
})

describe('dayChange', () => {
  it('is today’s change in pesos: the price less yesterday’s close', () => {
    expect(dayChange(row('X', 1050, 0.05))).toBeCloseTo(50, 9)
    expect(dayChange(row('Y', 990, -0.01))).toBeCloseTo(-10, 9)
  })

  it('no price or no change is no number', () => {
    expect(dayChange(row('X', null, 0.05))).toBeNull()
    expect(dayChange(row('X', 1050, null))).toBeNull()
  })
})

describe('pageRows', () => {
  const seven = [1, 2, 3, 4, 5, 6, 7]

  it('cuts the asked page and counts the pages', () => {
    expect(pageRows(seven, 2, 3)).toEqual({ rows: [4, 5, 6], page: 2, total: 7, pages: 3 })
  })

  it('takes a page before the first as the first, and one past the end as the last', () => {
    expect(pageRows(seven, 0, 3)).toEqual({ rows: [1, 2, 3], page: 1, total: 7, pages: 3 })
    expect(pageRows(seven, 9, 3)).toEqual({ rows: [7], page: 3, total: 7, pages: 3 })
  })

  it('an empty list is one empty page', () => {
    expect(pageRows([], 4, 25)).toEqual({ rows: [], page: 1, total: 0, pages: 1 })
  })
})

describe('filterRows', () => {
  it('matches the ticker or the name, ignoring case and accents', () => {
    const rows = marketRows(board, 'lider')
    expect(tickers(filterRows(rows, 'pampa energia'))).toEqual(['PAMP'])
    expect(tickers(filterRows(rows, 'ggal'))).toEqual(['GGAL'])
    expect(filterRows(rows, '  ')).toHaveLength(3)
  })
})

describe('the view in the URL', () => {
  it('defaults to the Panel líder by the day’s change, first page of 25, and writes nothing for the default', () => {
    const view = parseView(new URLSearchParams(''))
    expect(view).toEqual({ list: 'lider', sort: DEFAULT_SORT, page: 1, size: 25 })
    expect(serializeView(view)).toBe('')
  })

  it('round-trips a list and a sort', () => {
    const view = { list: 'cedears', sort: { key: 'ticker' as const, dir: 'asc' as const }, page: 1, size: 25 }
    expect(parseView(new URLSearchParams(serializeView(view)))).toEqual(view)
  })

  it('round-trips a page, a page size and the sort by today’s change in money', () => {
    const view = { list: 'lider', sort: { key: 'abs' as const, dir: 'asc' as const }, page: 3, size: 50 }
    expect(serializeView(view)).toBe('orden=abs%3Aasc&pagina=3&por=50')
    expect(parseView(new URLSearchParams(serializeView(view)))).toEqual(view)
  })

  it('takes a page that is not a whole number from 1 as the first, and a size it does not offer as 25', () => {
    for (const pagina of ['0', '-2', 'abc', '2.5']) expect(parseView(new URLSearchParams({ pagina })).page).toBe(1)
    expect(parseView(new URLSearchParams('por=30')).size).toBe(25)
    expect(parseView(new URLSearchParams('por=100')).size).toBe(100)
  })

  it('ignores a sort it does not know', () => {
    expect(parseView(new URLSearchParams('orden=nope:sideways')).sort).toEqual(DEFAULT_SORT)
  })
})
