import { describe, it, expect } from 'vitest'
import { TickMarkType } from 'lightweight-charts'
import { crosshairLabel, tickLabel } from '../time-labels'
import { toChartTime } from '../timeframes'

// odd/tasks/chart-display.md S1 and S4.
const at = (iso: string) => Date.parse(iso) / 1000

describe('crosshairLabel', () => {
  it('a daily, weekly or monthly bar reads its own date, not the day before (Buenos Aires is UTC−3)', () => {
    const label = crosshairLabel(toChartTime('2026-11-03'), false)
    expect(label).toMatch(/^3\b/)
    expect(label).toContain('2026')
    expect(crosshairLabel(toChartTime('2026-11-01'), false)).toMatch(/^1\b/)
  })

  it('an intraday bar reads Buenos Aires time', () => {
    const label = crosshairLabel(at('2026-11-03T14:30:00Z'), true)
    expect(label).toMatch(/^3\b/)
    expect(label).toContain('11:30')
  })
})

describe('tickLabel', () => {
  it('intraday hours are Buenos Aires time: a 16:00 UTC bar reads 13:00', () => {
    expect(tickLabel(at('2026-11-03T16:00:00Z'), TickMarkType.Time, true)).toBe('13:00')
  })

  it('an intraday day tick reads the Buenos Aires day, a month tick its month, a year tick its year', () => {
    expect(tickLabel(at('2026-11-03T14:30:00Z'), TickMarkType.DayOfMonth, true)).toBe('3')
    expect(tickLabel(at('2026-11-02T14:30:00Z'), TickMarkType.Month, true)).toMatch(/^nov/)
    expect(tickLabel(at('2026-01-02T14:30:00Z'), TickMarkType.Year, true)).toBe('2026')
  })

  it('daily and longer axes keep the library\'s own labels (null)', () => {
    expect(tickLabel(toChartTime('2026-11-03'), TickMarkType.DayOfMonth, false)).toBeNull()
  })
})
