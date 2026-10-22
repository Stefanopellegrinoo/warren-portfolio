import { describe, it, expect } from 'vitest'
import { buildChart, nearestIndex, historyNote, RANGES, type HistoryPoint } from '../chart'

const pt = (d: string, value: number, invested = 100, source: 'live' | 'estimated' = 'live'): HistoryPoint =>
  ({ snapshot_date: d, value, invested, source })

describe('RANGES', () => {
  it('maps each period to the API days parameter', () => {
    expect(RANGES.map(r => [r.id, r.days])).toEqual([['1M', '30'], ['3M', '90'], ['6M', '180'], ['1A', '365'], ['Todo', 'all']])
  })
})

describe('buildChart', () => {
  it('returns null when there is no history', () => {
    expect(buildChart([], 600, 220)).toBeNull()
  })

  it('draws a single point without NaN', () => {
    const c = buildChart([pt('2026-10-21', 100)], 600, 220)!
    expect(c.valuePath.startsWith('M')).toBe(true)
    expect(c.valuePath + c.investedPath).not.toContain('NaN')
  })

  it('keeps both series inside the plot, with the invested line included in the scale', () => {
    const pts = [pt('2026-10-01', 100, 50), pt('2026-10-02', 200, 50), pt('2026-10-03', 150, 50)]
    const c = buildChart(pts, 600, 220)!
    for (const v of [50, 100, 150, 200]) {
      expect(c.yAt(v)).toBeGreaterThanOrEqual(0)
      expect(c.yAt(v)).toBeLessThanOrEqual(220)
    }
    expect(c.yAt(200)).toBeLessThan(c.yAt(50))
    expect(c.xAt(0)).toBeLessThan(c.xAt(2))
    expect(c.xAt(2)).toBeLessThanOrEqual(600)
  })

  it('labels the y axis in es-AR thousands', () => {
    const c = buildChart([pt('2026-10-01', 41000, 37000), pt('2026-10-02', 40000, 37000)], 600, 220)!
    expect(c.yTicks.length).toBeGreaterThanOrEqual(2)
    expect(c.yTicks.every(t => /^\d+(,\d)?k$/.test(t.label))).toBe(true)
  })
})

describe('nearestIndex', () => {
  it('maps a pointer position to the closest point', () => {
    expect(nearestIndex(250, 50, 400, 5)).toBe(2)
  })

  it('clamps positions outside the plot', () => {
    expect(nearestIndex(-100, 50, 400, 5)).toBe(0)
    expect(nearestIndex(9999, 50, 400, 5)).toBe(4)
  })
})

describe('historyNote', () => {
  it('says what the series includes', () => {
    expect(historyNote([pt('2026-10-01', 1), pt('2026-10-02', 1)])).toBe('Acciones y caja. Las ONs no tienen historia todavía.')
  })

  it('discloses estimated days', () => {
    const pts = Array.from({ length: 10 }, (_, i) => pt(`2026-10-${10 + i}`, 1, 1, i < 3 ? 'estimated' : 'live'))
    expect(historyNote(pts)).toBe('Acciones y caja. Las ONs no tienen historia todavía. 3 de 10 días son estimados.')
  })

  it('uses the singular for one estimated day', () => {
    const pts = [pt('2026-10-01', 1, 1, 'estimated'), pt('2026-10-02', 1)]
    expect(historyNote(pts)).toBe('Acciones y caja. Las ONs no tienen historia todavía. 1 de 2 días es estimado.')
  })
})
