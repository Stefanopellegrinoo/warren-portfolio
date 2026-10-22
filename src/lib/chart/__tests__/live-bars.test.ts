import { describe, it, expect } from 'vitest'
import { barsToUpdate } from '../live-bars'

const bar = (time: number, close: number) => ({ time, open: 1, high: 2, low: 0.5, close, volume: 1 })

describe('barsToUpdate', () => {
  const prev = [bar(100, 1), bar(200, 1.5)]

  it('returns nothing when the poll brought the same bars', () => {
    expect(barsToUpdate(prev, [bar(100, 1), bar(200, 1.5)])).toEqual([])
  })

  it('returns the changed last bar', () => {
    expect(barsToUpdate(prev, [bar(100, 1), bar(200, 1.7)])).toEqual([bar(200, 1.7)])
  })

  it('returns the last bar and every new bar after it, in order', () => {
    expect(barsToUpdate(prev, [bar(100, 1), bar(200, 1.6), bar(300, 1.8)])).toEqual([bar(200, 1.6), bar(300, 1.8)])
  })

  it('returns null (reload everything) when the poll does not extend what is drawn', () => {
    expect(barsToUpdate([], [bar(100, 1)])).toBeNull()
    expect(barsToUpdate(prev, [bar(300, 1)])).toBeNull()
    expect(barsToUpdate(prev, [])).toBeNull()
  })
})
