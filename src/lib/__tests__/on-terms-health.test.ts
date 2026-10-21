import { describe, it, expect } from 'vitest'
import { isOnTermsStale, readOnTermsFreshness } from '../on-terms-health'

describe('isOnTermsStale', () => {
  it('is fresh within 2 business days and stale after', () => {
    expect(isOnTermsStale('2026-10-20', '2026-10-21')).toBe(false)
    expect(isOnTermsStale('2026-10-20', '2026-10-22')).toBe(false)
    expect(isOnTermsStale('2026-10-20', '2026-10-23')).toBe(true)
  })
  it('weekends do not count: Friday data is fresh on Monday', () => {
    expect(isOnTermsStale('2026-10-16', '2026-10-19')).toBe(false)
  })
})

describe('readOnTermsFreshness', () => {
  const client = (data: unknown, error: unknown = null) =>
    ({ from: () => ({ select: () => ({ order: () => ({ limit: () => Promise.resolve({ data, error }) }) }) }) }) as never
  it('returns the latest as_of and the stale flag', async () => {
    expect(await readOnTermsFreshness(client([{ as_of: '2026-10-20' }]), '2026-10-21')).toEqual({ asOf: '2026-10-20', stale: false })
    expect(await readOnTermsFreshness(client([{ as_of: '2026-10-01' }]), '2026-10-21')).toEqual({ asOf: '2026-10-01', stale: true })
  })
  it('empty table is stale with no date', async () => {
    expect(await readOnTermsFreshness(client([]), '2026-10-21')).toEqual({ asOf: null, stale: true })
  })
  it('never throws: unreadable is null', async () => {
    expect(await readOnTermsFreshness(client(null, { message: 'x' }), '2026-10-21')).toBeNull()
    expect(await readOnTermsFreshness({ from: () => { throw new Error('boom') } } as never, '2026-10-21')).toBeNull()
  })
})
