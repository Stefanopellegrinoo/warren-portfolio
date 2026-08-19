import { describe, it, expect, vi } from 'vitest'

// Mock the yahoo provider so we don't need actual Yahoo Finance credentials
vi.mock('./providers/yahoo', () => {
  class MockYahooProvider {
    getCandles = vi.fn()
    getQuote = vi.fn()
    searchTickers = vi.fn()
  }
  return { YahooProvider: MockYahooProvider }
})

describe('getMarketDataProvider factory', () => {
  it('returns same instance on two calls (singleton)', async () => {
    // Fresh import after mock is set up
    const { getMarketDataProvider } = await import('./index')
    const p1 = getMarketDataProvider()
    const p2 = getMarketDataProvider()
    expect(p1).toBe(p2)
  })

  it('returns an object implementing the provider interface', async () => {
    const { getMarketDataProvider } = await import('./index')
    const provider = getMarketDataProvider()
    expect(typeof provider.getCandles).toBe('function')
    expect(typeof provider.getQuote).toBe('function')
    expect(typeof provider.searchTickers).toBe('function')
  })
})
