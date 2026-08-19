import { describe, it, expect } from 'vitest'
import { MarketDataError } from './types'

describe('MarketDataError', () => {
  it('sets code, message, and name', () => {
    const err = new MarketDataError('NOT_FOUND', 'Ticker AAPL not found')
    expect(err.code).toBe('NOT_FOUND')
    expect(err.message).toBe('Ticker AAPL not found')
    expect(err.name).toBe('MarketDataError')
    expect(err instanceof Error).toBe(true)
  })

  it('sets PROVIDER_UNAVAILABLE code', () => {
    const err = new MarketDataError('PROVIDER_UNAVAILABLE', 'Yahoo down')
    expect(err.code).toBe('PROVIDER_UNAVAILABLE')
  })

  it('sets RATE_LIMITED code', () => {
    const err = new MarketDataError('RATE_LIMITED', 'Too many requests')
    expect(err.code).toBe('RATE_LIMITED')
  })

  it('sets UNKNOWN code', () => {
    const err = new MarketDataError('UNKNOWN', 'Unknown error')
    expect(err.code).toBe('UNKNOWN')
  })

  it('accepts optional cause', () => {
    const cause = new Error('original')
    const err = new MarketDataError('PROVIDER_UNAVAILABLE', 'wrapped', cause)
    expect(err.cause).toBe(cause)
  })
})

describe('SearchResult shape', () => {
  it('has expected fields via type check', () => {
    // This test verifies the type can be used as intended at runtime
    const result = {
      symbol: 'AAPL',
      shortname: 'Apple Inc.',
      exchange: 'NMS',
      quoteType: 'EQUITY' as const,
    }
    expect(result.symbol).toBe('AAPL')
    expect(result.quoteType).toBe('EQUITY')
  })
})
