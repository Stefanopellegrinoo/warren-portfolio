import { describe, it, expect } from 'vitest'
import type { MarketBoard } from './market-board'
import {
  DEFAULT_SORT, filterRows, inCurrency, listRows, marketRows, parseView, serializeView, sortRows, type ViewRow,
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
  it('defaults to the Panel líder by the day’s change, and writes nothing for the default', () => {
    const view = parseView(new URLSearchParams(''))
    expect(view).toEqual({ list: 'lider', sort: DEFAULT_SORT })
    expect(serializeView(view)).toBe('')
  })

  it('round-trips a list and a sort', () => {
    const view = { list: 'cedears', sort: { key: 'ticker' as const, dir: 'asc' as const } }
    expect(parseView(new URLSearchParams(serializeView(view)))).toEqual(view)
  })

  it('ignores a sort it does not know', () => {
    expect(parseView(new URLSearchParams('orden=nope:sideways')).sort).toEqual(DEFAULT_SORT)
  })
})
