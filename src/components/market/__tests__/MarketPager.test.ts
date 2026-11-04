import { describe, it, expect } from 'vitest'
import { pageNumbers } from '../MarketPager'

describe('pageNumbers', () => {
  it('shows the first, the last and the neighbours of the current page, with gaps between', () => {
    expect(pageNumbers(1, 16)).toEqual([1, 2, null, 16])
    expect(pageNumbers(8, 16)).toEqual([1, null, 7, 8, 9, null, 16])
    expect(pageNumbers(16, 16)).toEqual([1, null, 15, 16])
  })

  it('leaves no gap where the pages touch, and one page is just itself', () => {
    expect(pageNumbers(3, 5)).toEqual([1, 2, 3, 4, 5])
    expect(pageNumbers(1, 1)).toEqual([1])
  })
})
