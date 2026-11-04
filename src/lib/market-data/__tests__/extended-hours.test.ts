import { describe, it, expect } from 'vitest'
import { extendedHours } from '../extended-hours'

// odd/tasks/extended-hours.md S1. Yahoo's quote() times are Dates; its change percents are in percent units.
const closeYesterday = new Date('2026-11-03T21:00:03Z')
const postYesterday = { postMarketPrice: 139.68, postMarketChangePercent: 0.06, postMarketTime: new Date('2026-11-04T00:55:53Z') }
const preToday = { preMarketPrice: 129.88, preMarketChangePercent: -6.95, preMarketTime: new Date('2026-11-04T12:58:48Z') }

describe('extendedHours', () => {
  it('before the open: the pre-market, traded after yesterday\'s close and after last evening\'s post-market', () => {
    expect(extendedHours({ regularMarketTime: closeYesterday, ...postYesterday, ...preToday }))
      .toEqual({ session: 'pre', price: 129.88, changePercent: -6.95 })
  })

  it('after the close: the post-market, not the morning\'s pre-market', () => {
    const closeToday = new Date('2026-11-04T21:00:01Z')
    const postToday = { postMarketPrice: 141, postMarketChangePercent: 1.2, postMarketTime: new Date('2026-11-04T22:10:00Z') }
    expect(extendedHours({ regularMarketTime: closeToday, ...preToday, ...postToday }))
      .toEqual({ session: 'post', price: 141, changePercent: 1.2 })
  })

  it('overnight and over the weekend: last evening\'s post-market', () => {
    expect(extendedHours({ regularMarketTime: closeYesterday, ...postYesterday }))
      .toEqual({ session: 'post', price: 139.68, changePercent: 0.06 })
  })

  it('during the regular session: none, both extended sessions traded before its last trade', () => {
    expect(extendedHours({ regularMarketTime: new Date('2026-11-04T15:30:00Z'), ...postYesterday, ...preToday })).toBeNull()
  })

  it('none without a price, a change or a regular time to compare with', () => {
    expect(extendedHours({ regularMarketTime: closeYesterday })).toBeNull()
    expect(extendedHours({ regularMarketTime: closeYesterday, ...preToday, preMarketPrice: undefined })).toBeNull()
    expect(extendedHours({ regularMarketTime: closeYesterday, ...preToday, preMarketChangePercent: undefined })).toBeNull()
    expect(extendedHours({ ...preToday })).toBeNull()
  })
})
