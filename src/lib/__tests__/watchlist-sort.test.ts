// odd/tasks/extended-hours.md S4: the Gráficos watchlist sorts by a header click.
import { describe, it, expect } from 'vitest'
import { nextSort, sortSymbols } from '../watchlist-sort'

describe('nextSort: a header click', () => {
  it('Símbolo goes A→Z, then Z→A, then back to the list order', () => {
    const first = nextSort(null, 'symbol')
    expect(first).toEqual({ key: 'symbol', dir: 'asc' })
    const second = nextSort(first, 'symbol')
    expect(second).toEqual({ key: 'symbol', dir: 'desc' })
    expect(nextSort(second, 'symbol')).toBeNull()
  })

  it('a number goes highest first, then lowest first, then back to the list order', () => {
    for (const key of ['price', 'pct', 'ext'] as const) {
      const first = nextSort(null, key)
      expect(first).toEqual({ key, dir: 'desc' })
      const second = nextSort(first, key)
      expect(second).toEqual({ key, dir: 'asc' })
      expect(nextSort(second, key)).toBeNull()
    }
  })

  it('another column starts over at its own first direction', () => {
    expect(nextSort({ key: 'price', dir: 'asc' }, 'symbol')).toEqual({ key: 'symbol', dir: 'asc' })
    expect(nextSort({ key: 'symbol', dir: 'desc' }, 'ext')).toEqual({ key: 'ext', dir: 'desc' })
  })
})

describe('sortSymbols', () => {
  const rows = {
    MSFT: { price: 400, pct: -1, ext: 0.5 },
    AAPL: { price: 200, pct: 2, ext: null },
    NVDA: { price: 100, pct: 1, ext: -3 },
  }
  const list = ['MSFT', 'AAPL', 'NVDA', 'GGAL'] // GGAL: no quote yet

  it('without a sort keeps the list’s own order', () => {
    expect(sortSymbols(list, rows, null)).toEqual(list)
  })

  it('sorts by the symbol and by each number', () => {
    expect(sortSymbols(list, rows, { key: 'symbol', dir: 'asc' })).toEqual(['AAPL', 'GGAL', 'MSFT', 'NVDA'])
    expect(sortSymbols(list, rows, { key: 'symbol', dir: 'desc' })).toEqual(['NVDA', 'MSFT', 'GGAL', 'AAPL'])
    expect(sortSymbols(list, rows, { key: 'price', dir: 'desc' })).toEqual(['MSFT', 'AAPL', 'NVDA', 'GGAL'])
    expect(sortSymbols(list, rows, { key: 'pct', dir: 'asc' })).toEqual(['MSFT', 'NVDA', 'AAPL', 'GGAL'])
  })

  it('rows without a value go last in both directions', () => {
    expect(sortSymbols(list, rows, { key: 'ext', dir: 'desc' })).toEqual(['MSFT', 'NVDA', 'AAPL', 'GGAL'])
    expect(sortSymbols(list, rows, { key: 'ext', dir: 'asc' })).toEqual(['NVDA', 'MSFT', 'AAPL', 'GGAL'])
  })

  it('does not change the list it is given', () => {
    const copy = [...list]
    sortSymbols(list, rows, { key: 'price', dir: 'asc' })
    expect(list).toEqual(copy)
  })
})
