import { describe, it, expect } from 'vitest'
import { searchAssets } from '../asset-search'

const cat = [
  { ticker: 'DUK', nombre: 'Duke Energy' },
  { ticker: 'AAPL', nombre: 'Apple' },
  { ticker: 'DE', nombre: 'Deere' },
]

describe('searchAssets', () => {
  it('shows only held assets for an empty query', () => {
    expect(searchAssets('', ['DUK'], cat)).toEqual([{ ticker: 'DUK', name: 'Duke Energy', held: true }])
    expect(searchAssets('   ', [], cat)).toEqual([])
  })

  it('ranks exact ticker, then ticker prefix, then name match', () => {
    const ranked = [...cat, { ticker: 'DEO', nombre: 'Diageo' }, { ticker: 'X', nombre: 'Deluxe' }]
    expect(searchAssets('de', [], ranked).map(r => r.ticker)).toEqual(['DE', 'DEO', 'X'])
  })

  it('matches names case-insensitively', () => {
    expect(searchAssets('apple', [], cat)[0].ticker).toBe('AAPL')
  })

  it('returns nothing when nothing matches', () => {
    expect(searchAssets('zzz', [], cat)).toEqual([])
  })

  it('never lists an asset twice and flags held ones', () => {
    expect(searchAssets('duk', ['DUK'], cat)).toEqual([{ ticker: 'DUK', name: 'Duke Energy', held: true }])
  })

  it('includes held tickers missing from the catalog', () => {
    expect(searchAssets('', ['XYZ'], cat)).toEqual([{ ticker: 'XYZ', name: null, held: true }])
  })

  it('drops a catalog name that only repeats the ticker', () => {
    expect(searchAssets('', ['SPG'], [{ ticker: 'SPG', nombre: 'SPG' }])).toEqual([{ ticker: 'SPG', name: null, held: true }])
  })

  it('caps results at the limit', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ ticker: `A${i}`, nombre: `Asset ${i}` }))
    expect(searchAssets('a', [], many, 8)).toHaveLength(8)
  })
})
