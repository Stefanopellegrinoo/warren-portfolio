import { describe, it, expect } from 'vitest'
import { snapshotWriteTime, staleSnapshots } from '../retroactive-entry'

const live = (snapshot_date: string) => ({ snapshot_date, source: 'live' as const })
const estimated = (snapshot_date: string) => ({ snapshot_date, source: 'estimated' as const })

describe('snapshotWriteTime', () => {
  it('places the write at 02:00 UTC the day after the stamped date', () => {
    // The daily job runs `0 2 * * 2-6` UTC = 23:00 ART of the day it stamps.
    expect(snapshotWriteTime('2026-07-23').toISOString()).toBe('2026-07-24T02:00:00.000Z')
  })
})

describe('staleSnapshots', () => {
  // The real case. DNCBD, 250 x 100.50, dated 2026-07-02, entered 22.8 days
  // late. The 07-23 row was written 07-24T02:00Z, sixteen hours before the
  // entry existed, so it measured a portfolio missing the whole position.
  const dncbdEnteredAt = new Date('2026-07-24T18:20:00.000Z')

  it('flags the measured row that was already written, and only that one', () => {
    const result = staleSnapshots('2026-07-02', dncbdEnteredAt, [
      live('2026-07-23'),
      live('2026-07-24'),
      live('2026-07-27'),
    ])
    // 07-24 was written at 07-25T02:00Z, AFTER the entry — it includes it.
    expect(result).toEqual(['2026-07-23'])
  })

  it('counts a row with no source as live', () => {
    // Migration 033 declares the column `not null default 'live'`.
    const result = staleSnapshots('2026-07-02', dncbdEnteredAt, [{ snapshot_date: '2026-07-23' }])
    expect(result).toEqual(['2026-07-23'])
  })

  // THE false-positive guard. This is the test that kills the naive lag rule:
  // the bulk import carries operation dates years old, but every row was
  // created before the first live snapshot existed, so nothing is stale.
  it('flags nothing for the bulk import, with no lag threshold involved', () => {
    const importedAt = new Date('2026-07-20T14:00:00.000Z')
    const result = staleSnapshots('2022-05-10', importedAt, [
      live('2026-07-23'),
      live('2026-07-24'),
      live('2026-07-31'),
    ])
    expect(result).toEqual([])
  })

  it('never flags a reconstructed row', () => {
    // An estimated row's write time is when the backfill ran, which is not
    // stored — and a reconstructed row can simply be reconstructed again.
    const result = staleSnapshots('2026-06-01', new Date('2026-07-28T12:00:00.000Z'), [
      estimated('2026-07-01'),
      estimated('2026-07-22'),
    ])
    expect(result).toEqual([])
  })

  it('flags nothing when the row has not been written yet', () => {
    // Entered 01:00 UTC on 07-31; the 07-30 row is written at 07-31T02:00Z.
    // The job has not run, so it will pick this entry up on its own.
    const result = staleSnapshots('2026-07-30', new Date('2026-07-31T01:00:00.000Z'), [
      live('2026-07-30'),
    ])
    expect(result).toEqual([])
  })

  it('flags nothing for a same-day entry', () => {
    const result = staleSnapshots('2026-08-03', new Date('2026-08-03T15:00:00.000Z'), [
      live('2026-07-31'),
    ])
    expect(result).toEqual([])
  })

  it('returns the dates sorted, oldest first', () => {
    const result = staleSnapshots('2026-07-20', new Date('2026-08-03T15:00:00.000Z'), [
      live('2026-07-31'),
      live('2026-07-23'),
      live('2026-07-27'),
    ])
    expect(result).toEqual(['2026-07-23', '2026-07-27', '2026-07-31'])
  })

  it('warns about nothing rather than everything on an unparseable timestamp', () => {
    const result = staleSnapshots('2026-07-02', new Date('nonsense'), [live('2026-07-23')])
    expect(result).toEqual([])
  })
})
