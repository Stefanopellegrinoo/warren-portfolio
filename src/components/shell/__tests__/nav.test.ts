import { describe, it, expect } from 'vitest'
import { activeHref, topHoldings, NAV_ITEMS, PERSONAL_ITEMS } from '../nav'

describe('NAV_ITEMS', () => {
  it('lists the approved menu in order', () => {
    expect(NAV_ITEMS.map(i => [i.label, i.href])).toEqual([
      ['Resumen', '/dashboard'],
      ['Gráficos', '/trading'],
      ['Operaciones', '/history'],
      ['Rendimiento', '/statistics'],
      ['Obligaciones negociables', '/ons'],
      ['Estrategias y alertas', '/strategies'],
    ])
    expect(PERSONAL_ITEMS.map(i => [i.label, i.href])).toEqual([['Gastos', '/cashflow']])
  })
})

describe('activeHref', () => {
  it('marks a section as active for its subpages', () => {
    expect(activeHref('/ons/carteras/abc')).toBe('/ons')
    expect(activeHref('/strategies/1/performance')).toBe('/strategies')
  })

  it('matches exact routes', () => {
    expect(activeHref('/dashboard')).toBe('/dashboard')
    expect(activeHref('/cashflow')).toBe('/cashflow')
  })

  it('returns null outside the menu and for lookalike prefixes', () => {
    expect(activeHref('/auth/login')).toBeNull()
    expect(activeHref('/onsx')).toBeNull()
  })
})

describe('topHoldings', () => {
  it('sorts by value, computes weight and drops unpriced positions', () => {
    expect(topHoldings([{ ticker: 'A', market_value: 10 }, { ticker: 'B', market_value: 30 }, { ticker: 'C' }], 40, 5))
      .toEqual([{ ticker: 'B', weightPct: 75 }, { ticker: 'A', weightPct: 25 }])
  })

  it('caps the list at n', () => {
    const many = ['A', 'B', 'C'].map((t, i) => ({ ticker: t, market_value: i + 1 }))
    expect(topHoldings(many, 6, 2).map(h => h.ticker)).toEqual(['C', 'B'])
  })

  it('handles an empty portfolio without NaN', () => {
    expect(topHoldings([], 0)).toEqual([])
    expect(topHoldings([{ ticker: 'A', market_value: 5 }], 0)).toEqual([{ ticker: 'A', weightPct: 0 }])
  })
})
