import { describe, it, expect } from 'vitest'
import { isBusinessDay, adjust, addBusinessDays, settlementDate, addDays } from './ar-calendar'

describe('isBusinessDay', () => {
  it('rejects weekends', () => {
    expect(isBusinessDay('2026-10-24')).toBe(false) // Saturday
    expect(isBusinessDay('2026-10-25')).toBe(false) // Sunday
    expect(isBusinessDay('2026-10-23')).toBe(true) // Friday
  })

  it('rejects fixed holidays', () => {
    expect(isBusinessDay('2026-07-09')).toBe(false) // Independence Day (Thu)
    expect(isBusinessDay('2026-05-01')).toBe(false)
    expect(isBusinessDay('2026-12-25')).toBe(false)
  })

  it('rejects decreed bridge days (2026)', () => {
    expect(isBusinessDay('2026-07-10')).toBe(false)
    expect(isBusinessDay('2026-03-23')).toBe(false)
    expect(isBusinessDay('2026-12-07')).toBe(false)
  })

  it('rejects Easter-based holidays (Carnival, Good Friday)', () => {
    expect(isBusinessDay('2026-02-16')).toBe(false)
    expect(isBusinessDay('2026-02-17')).toBe(false)
    expect(isBusinessDay('2026-04-03')).toBe(false)
    expect(isBusinessDay('2026-04-02')).toBe(false) // Malvinas, fixed
  })

  it('moves movable holidays by weekday (Wed -> prev Mon, Fri -> next Mon)', () => {
    expect(isBusinessDay('2026-06-17')).toBe(true) // Guemes fell on Wed
    expect(isBusinessDay('2026-06-15')).toBe(false)
    expect(isBusinessDay('2026-11-20')).toBe(true) // fell on Fri
    expect(isBusinessDay('2026-11-23')).toBe(false)
  })

  it('falls back to rule-based holidays for a year without decrees', () => {
    expect(isBusinessDay('2030-04-19')).toBe(false) // Good Friday 2030
    expect(isBusinessDay('2030-03-04')).toBe(false) // Carnival Monday 2030
    expect(isBusinessDay('2030-11-18')).toBe(false) // Nov 20 Wed -> Mon 18
    expect(isBusinessDay('2030-07-10')).toBe(true) // no decreed bridge known
  })
})

describe('adjust', () => {
  it('following moves a Saturday to Monday', () => {
    expect(adjust('2026-10-24', 'following')).toBe('2026-10-26')
  })

  it('returns a business day unchanged', () => {
    expect(adjust('2026-10-23', 'following')).toBe('2026-10-23')
  })

  it('preceding moves a Saturday to Friday', () => {
    expect(adjust('2026-10-24', 'preceding')).toBe('2026-10-23')
  })

  it('modified_following goes back when following crosses month end', () => {
    // 2026-05-30 is Saturday; following would be 2026-06-01 (next month)
    expect(adjust('2026-05-30', 'following')).toBe('2026-06-01')
    expect(adjust('2026-05-30', 'modified_following')).toBe('2026-05-29')
  })

  it('modified_following behaves as following inside the month', () => {
    expect(adjust('2026-10-24', 'modified_following')).toBe('2026-10-26')
  })

  it('skips consecutive non-business days (holiday + bridge + weekend)', () => {
    expect(adjust('2026-07-09', 'following')).toBe('2026-07-13')
  })
})

describe('settlement (T+1)', () => {
  it('Wednesday settles Thursday', () => {
    expect(settlementDate('2026-10-21')).toBe('2026-10-22')
  })

  it('Friday settles Monday', () => {
    expect(settlementDate('2026-10-23')).toBe('2026-10-26')
  })

  it('Friday before a Monday holiday settles Tuesday', () => {
    // 2026-02-13 Fri, Carnival Mon/Tue 16/17 -> Wednesday 18
    expect(settlementDate('2026-02-13')).toBe('2026-02-18')
    // 2026-05-22 Fri, 05-25 Mon holiday -> Tue 26
    expect(settlementDate('2026-05-22')).toBe('2026-05-26')
  })

  it('addBusinessDays counts only business days', () => {
    expect(addBusinessDays('2026-10-23', 2)).toBe('2026-10-27')
  })
})

describe('addDays', () => {
  it('is calendar-day arithmetic on ISO dates', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
})

describe('decreed days and ad hoc moves (2024-2025)', () => {
  it.each([
    '2024-04-01',
    '2024-06-21',
    '2024-10-11',
    '2025-05-02',
    '2025-08-15',
    '2025-11-21',
  ])('%s is a decreed non-business day', (d) => {
    expect(isBusinessDay(d)).toBe(false)
  })

  it('2025-10-12 (Sunday) was moved to Friday 2025-10-10', () => {
    expect(isBusinessDay('2025-10-10')).toBe(false)
  })

  it('adjusts across a decreed day into the next month/year range', () => {
    expect(adjust('2024-10-11', 'following')).toBe('2024-10-14')
    expect(adjust('2024-06-21', 'preceding')).toBe('2024-06-19') // 06-20 is a fixed holiday
  })
})

describe('addBusinessDays backwards', () => {
  it('steps back over weekends and holidays', () => {
    expect(addBusinessDays('2026-07-13', -1)).toBe('2026-07-08') // 07-09 holiday, 07-10 decreed
    expect(addBusinessDays('2026-10-26', -1)).toBe('2026-10-23')
  })
})

describe('date validation', () => {
  it.each(['2026-02-30', '2026-13-01', '2026-1-01', 'abc', '2026-04-31'])('rejects %s', (d) => {
    expect(() => isBusinessDay(d)).toThrow(/invalid ISO date/)
  })
})
