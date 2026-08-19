import { describe, it, expect } from 'vitest'
import { argentinaDate } from '../utils'

/**
 * Snapshots are stamped with the ARGENTINE calendar day, not the UTC one.
 * The daily job runs at 02:00 UTC, which is 23:00 the previous day in
 * Argentina — stamping the UTC date there would file the whole evening under
 * tomorrow and break the pairing with cash_movements.date.
 */
describe('argentinaDate', () => {
  it('returns an ISO calendar date', () => {
    expect(argentinaDate(new Date('2026-07-23T15:00:00Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('returns the same day during the middle of the UTC day', () => {
    // 15:00 UTC = 12:00 ART, same date either way
    expect(argentinaDate(new Date('2026-07-23T15:00:00Z'))).toBe('2026-07-23')
  })

  it('returns the PREVIOUS day when the job runs at 02:00 UTC', () => {
    // The scheduled snapshot slot: 02:00 UTC Friday = 23:00 ART Thursday
    expect(argentinaDate(new Date('2026-07-24T02:00:00Z'))).toBe('2026-07-23')
  })

  it('still returns the previous day just before the ART midnight boundary', () => {
    // 02:59 UTC = 23:59 ART the day before
    expect(argentinaDate(new Date('2026-07-24T02:59:59Z'))).toBe('2026-07-23')
  })

  it('rolls over exactly at 03:00 UTC, which is ART midnight', () => {
    expect(argentinaDate(new Date('2026-07-24T03:00:00Z'))).toBe('2026-07-24')
  })

  it('files a late-evening ART moment under that same ART day', () => {
    // The withdrawal that exposed the bug: 23:54 ART-side of the boundary.
    // 2026-07-23T23:54Z is 20:54 ART on the 23rd — must stay on the 23rd.
    expect(argentinaDate(new Date('2026-07-23T23:54:02Z'))).toBe('2026-07-23')
  })

  it('does NOT drift to tomorrow late in the UTC day', () => {
    // The exact failure seen in production: a manual snapshot at 00:20 UTC
    // stamped 2026-07-24 while it was still the 23rd in Argentina.
    expect(argentinaDate(new Date('2026-07-24T00:20:00Z'))).toBe('2026-07-23')
  })

  it('handles a year boundary', () => {
    // 01:00 UTC Jan 1 = 22:00 ART Dec 31
    expect(argentinaDate(new Date('2027-01-01T01:00:00Z'))).toBe('2026-12-31')
  })
})
