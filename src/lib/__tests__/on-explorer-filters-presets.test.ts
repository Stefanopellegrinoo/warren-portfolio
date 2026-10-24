import { describe, it, expect } from 'vitest'
import type { OnListRow } from '../on-analytics'
import {
  activeFilterCount, applyExplorer, DEFAULT_STATE, parseExplorerQuery, presetActive, PRESETS, serializeExplorerQuery, togglePreset,
  type ExplorerFilters,
} from '../on-explorer-filters'

const f = (over: Partial<ExplorerFilters> = {}): ExplorerFilters => ({ ...DEFAULT_STATE.filters, ...over })
const preset = (id: string) => PRESETS.find((p) => p.id === id)!
const TODAY = '2026-10-24'

describe('activeFilterCount (S4: "Filtros · N")', () => {
  it('counts the filters behind the control, not the always-visible search', () => {
    expect(activeFilterCount(f())).toBe(0)
    expect(activeFilterCount(f({ q: 'ypf' }))).toBe(0)
    expect(activeFilterCount(f({ law: 'NY', ytmMin: 0, maturityTo: '2028-01-01' }))).toBe(3)
  })
})

describe('presets', () => {
  it('each preset is a patch of existing filter fields', () => {
    expect(preset('mep').patch(TODAY)).toEqual({ currency: 'USD MEP' })
    expect(preset('ny').patch(TODAY)).toEqual({ law: 'NY' })
    expect(preset('short').patch(TODAY)).toEqual({ maturityTo: '2028-10-24' })
    expect(preset('short').patch('2028-02-29')).toEqual({ maturityTo: '2030-02-28' })
  })

  it('a tap turns a preset on, a second tap restores the defaults of its fields only', () => {
    const on = togglePreset(f({ issuer: 'Alfa S.A.' }), preset('ny'), TODAY)
    expect(on).toEqual({ law: 'NY' })
    const now = f({ issuer: 'Alfa S.A.', ...on })
    expect(presetActive(now, preset('ny'), TODAY)).toBe(true)
    expect(togglePreset(now, preset('ny'), TODAY)).toEqual({ law: '' })
  })

  it('"Vencen en 2 años o menos" keeps rows maturing up to that day', () => {
    const row = (isin: string, maturityDate: string) => ({ isin, tickerO: isin, maturityDate }) as unknown as OnListRow
    const rows = [row('A', '2027-01-01'), row('B', '2028-10-24'), row('C', '2028-10-25')]
    const filters = f(togglePreset(f(), preset('short'), TODAY))
    expect(applyExplorer(rows, { filters, sort: { key: 'maturity', dir: 'asc' } }).map((r) => r.isin)).toEqual(['A', 'B'])
  })
})

describe('URL compatibility', () => {
  it('a query written before the presets parses to the same filters and serializes back unchanged', () => {
    const legacy = 'q=cs50&issuer=Alfa+S.A.&currency=USD+MEP&maturityFrom=2027-01-01&maturityTo=2030-12-31&law=NY&rateType=fixed&ytmMin=8.5&ytmMax=12&mdMin=1&mdMax=4&sort=ytm&dir=desc'
    const s = parseExplorerQuery(legacy)
    expect(s.filters).toEqual({
      q: 'cs50', issuer: 'Alfa S.A.', currency: 'USD MEP', law: 'NY', rateType: 'fixed',
      maturityFrom: '2027-01-01', maturityTo: '2030-12-31', ytmMin: 8.5, ytmMax: 12, mdMin: 1, mdMax: 4,
    })
    expect(s.sort).toEqual({ key: 'ytm', dir: 'desc' })
    expect(serializeExplorerQuery(s)).toBe(legacy)
  })
})
