import { describe, it, expect } from 'vitest'
import { dropIdleToday } from '../twr-series'

// odd/tasks/day-change.md S4: the Mi cartera chart never ends on a "today" without a session.
const pt = (date: string, twrIndex: number) => ({ date, twrIndex, twrPct: (twrIndex - 1) * 100 })
const series = (today: string, last: number) => [pt('2026-10-29', 1.5), pt('2026-10-30', 1.53), pt(today, last)]

describe('dropIdleToday', () => {
  it('drops today on a Saturday or a Sunday, even when the point moved (a peso CCL drift)', () => {
    expect(dropIdleToday(series('2026-10-31', 1.531), '2026-10-31').map((p) => p.date)).toEqual(['2026-10-29', '2026-10-30'])
    expect(dropIdleToday(series('2026-11-01', 1.53), '2026-11-01').at(-1)?.date).toBe('2026-10-30')
  })

  it('drops today on a weekday when it did not move from the last session (a holiday)', () => {
    expect(dropIdleToday(series('2026-11-02', 1.53), '2026-11-02').at(-1)?.date).toBe('2026-10-30')
  })

  it('keeps today on a weekday with a session', () => {
    expect(dropIdleToday(series('2026-11-02', 1.52), '2026-11-02').at(-1)).toEqual(pt('2026-11-02', 1.52))
  })

  it('touches nothing when the last point is not today, or there is no earlier point', () => {
    const past = [pt('2026-10-29', 1.5), pt('2026-10-30', 1.53)]
    expect(dropIdleToday(past, '2026-11-01')).toEqual(past)
    expect(dropIdleToday([pt('2026-11-01', 1)], '2026-11-01')).toEqual([pt('2026-11-01', 1)])
  })
})
