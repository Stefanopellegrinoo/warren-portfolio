import { describe, it, expect } from 'vitest'
import { PortfolioNameSchema, ItemCreateSchema, ItemUpdateSchema, MAX_PORTFOLIOS, MAX_ITEMS, MAX_NAME } from './test-portfolio'

describe('test portfolio schemas', () => {
  it('exposes the product limits (A6)', () => {
    expect([MAX_PORTFOLIOS, MAX_ITEMS, MAX_NAME]).toEqual([20, 50, 60])
  })

  it('name: trimmed, 1-60 chars', () => {
    expect(PortfolioNameSchema.parse({ name: '  Mi cartera  ' })).toEqual({ name: 'Mi cartera' })
    expect(PortfolioNameSchema.safeParse({ name: '   ' }).success).toBe(false)
    expect(PortfolioNameSchema.safeParse({ name: 'x'.repeat(61) }).success).toBe(false)
    expect(PortfolioNameSchema.safeParse({ name: 5 }).success).toBe(false)
  })

  it('item: ISIN is uppercased and shape-checked; mode is usd|vn; amount positive finite and bounded', () => {
    expect(ItemCreateSchema.parse({ isin: ' ar0394353335 ', mode: 'usd', amount: 1000 })).toEqual({ isin: 'AR0394353335', mode: 'usd', amount: 1000, manualPrice: null })
    for (const bad of [
      { isin: 'nope', mode: 'usd', amount: 1 }, { isin: 'AR0394353335', mode: 'eur', amount: 1 },
      { isin: 'AR0394353335', mode: 'usd', amount: 0 }, { isin: 'AR0394353335', mode: 'usd', amount: -5 },
      { isin: 'AR0394353335', mode: 'usd', amount: 1e13 }, { isin: 'AR0394353335', mode: 'usd', amount: '10' },
      { isin: 'AR0394353335', mode: 'usd', amount: Infinity }, { isin: 'AR0394353335', mode: 'usd', amount: 1, manualPrice: 0 },
    ]) expect(ItemCreateSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
  })

  it('item: unknown keys (e.g. a user_id or portfolio_id smuggled in) are rejected', () => {
    expect(ItemCreateSchema.safeParse({ isin: 'AR0394353335', mode: 'usd', amount: 1, portfolio_id: 'x' }).success).toBe(false)
  })

  it('update: at least one field; manualPrice null clears it', () => {
    expect(ItemUpdateSchema.safeParse({}).success).toBe(false)
    expect(ItemUpdateSchema.parse({ manualPrice: null })).toEqual({ manualPrice: null })
    expect(ItemUpdateSchema.parse({ amount: 5, mode: 'vn' })).toEqual({ amount: 5, mode: 'vn' })
    expect(ItemUpdateSchema.safeParse({ isin: 'AR0394353335' }).success).toBe(false)
  })
})
