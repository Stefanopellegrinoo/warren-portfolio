import { describe, it, expect } from 'vitest'
import { activeHref, NAV_ITEMS, PERSONAL_ITEMS } from '../nav'

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
