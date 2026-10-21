import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.mock('../data912-client', () => ({ fetchAllData912Quotes: () => mockFetch() }))

import { captureOnPriceHistory, filterCorporateD, DATA912_C_IS_DIRTY } from '../on-price-history'

// Shape verified with a live GET of https://data912.com/live/arg_corp (2026-10-16)
const row = (symbol: string, c: number | null, v = 100, extra = {}) => ({
  symbol, c, v, px_bid: c, px_ask: c, q_bid: 1, q_ask: 1, q_op: 1, pct_change: 0.5, ...extra,
})

interface Stored { ticker: string; price_date: string; close: number; volume: number; captured_at?: number }

/** In-memory on_price_history with just the chains the capture uses. */
function fakeSupabase(initial: Stored[] = []) {
  const store = [...initial]
  const upserts: Array<{ rows: any[]; opts: any }> = []
  let tick = 0
  const from = vi.fn(() => ({
    select: (_cols: string) => ({
      lt: (_c: string, date: string) => ({
        order: () => ({
          limit: async () => {
            const dates = store.map(r => r.price_date).filter(d => d < date).sort().reverse()
            return { data: dates.length ? [{ price_date: dates[0] }] : [], error: null }
          },
        }),
      }),
      eq: async (_c: string, date: string) => ({ data: store.filter(r => r.price_date === date), error: null }),
    }),
    upsert: async (rows: any[], opts: any) => {
      upserts.push({ rows, opts })
      for (const r of rows) {
        const i = store.findIndex(s => s.ticker === r.ticker && s.price_date === r.price_date)
        const next = { ...r, captured_at: ++tick }
        if (i >= 0) store[i] = next
        else store.push(next)
      }
      return { error: null }
    },
  }))
  return { client: { from } as any, store, upserts }
}

const feed250 = () => [
  ...Array.from({ length: 250 }, (_, i) => row(`T${String(i).padStart(3, '0')}D`, 100 + i)),
  row('AEC3O', 150140),
  row('XYZC', 5),
]

beforeEach(() => mockFetch.mockReset())

describe('filterCorporateD', () => {
  it('keeps D-suffixed rows with c > 0 and drops null/zero/negative', () => {
    const out = filterCorporateD([row('AERBD', 101), row('AERBD2', 1), row('AAAD', 0), row('BBBD', -1), row('CCCD', null), row('XO', 9)] as any)
    expect(out.map(r => r.symbol)).toEqual(['AERBD'])
  })
})

describe('captureOnPriceHistory', () => {
  it('S1.1 stores the whole D feed, not just held tickers', async () => {
    mockFetch.mockResolvedValue(feed250())
    const db = fakeSupabase()
    const n = await captureOnPriceHistory(db.client, '2026-10-16')
    expect(n).toBe(250)
    expect(db.store).toHaveLength(250)
    expect(db.store.every(r => r.price_date === '2026-10-16')).toBe(true)
  })

  it('S1.2 re-run is last-wins and idempotent', async () => {
    mockFetch.mockResolvedValue([row('AERBD', 100.3)])
    const db = fakeSupabase()
    await captureOnPriceHistory(db.client, '2026-10-16')
    const first = db.store[0].captured_at!
    mockFetch.mockResolvedValue([row('AERBD', 100.5)])
    await captureOnPriceHistory(db.client, '2026-10-16')
    expect(db.store).toHaveLength(1)
    expect(db.store[0].close).toBe(100.5)
    expect(db.store[0].captured_at).toBeGreaterThan(first)
    expect(db.upserts[0].opts).toEqual({ onConflict: 'ticker,price_date' })
  })

  it('S1.3 fetch failure, non-array and zero D rows write nothing and THROW so the day is alerted', async () => {
    // The job only runs on weekdays; a holiday is caught by the stale check, so an
    // empty feed is an outage — returning 0 would lose the day silently.
    const db = fakeSupabase()
    mockFetch.mockRejectedValue(new Error('boom'))
    await expect(captureOnPriceHistory(db.client, '2026-10-16')).rejects.toThrow('boom')
    mockFetch.mockResolvedValue({ not: 'array' })
    await expect(captureOnPriceHistory(db.client, '2026-10-16')).rejects.toThrow(/no usable/)
    mockFetch.mockResolvedValue([row('AEC3O', 1)])
    await expect(captureOnPriceHistory(db.client, '2026-10-16')).rejects.toThrow(/no usable/)
    expect(db.upserts).toHaveLength(0)
  })

  it('a duplicate symbol in the feed is written once (Postgres rejects it twice in one upsert)', async () => {
    const db = fakeSupabase()
    mockFetch.mockResolvedValue([row('AAAD', 100), row('AAAD', 101)])
    expect(await captureOnPriceHistory(db.client, '2026-10-16')).toBe(1)
    expect(db.upserts[0].rows).toHaveLength(1)
  })

  it('S1.3 null c is skipped, other symbols still written, prior dates untouched', async () => {
    const db = fakeSupabase([{ ticker: 'OLDD', price_date: '2026-10-14', close: 50, volume: 1 }])
    mockFetch.mockResolvedValue([row('AERBD', 101), row('NULLD', null)])
    await captureOnPriceHistory(db.client, '2026-10-16')
    expect(db.store.map(r => r.ticker).sort()).toEqual(['AERBD', 'OLDD'])
    expect(db.store.find(r => r.ticker === 'OLDD')!.close).toBe(50)
  })

  it('S1.4 c <= 0 is not written', async () => {
    mockFetch.mockResolvedValue([row('AAAD', 0), row('BBBD', -3), row('CCCD', 10)])
    const db = fakeSupabase()
    await captureOnPriceHistory(db.client, '2026-10-16')
    expect(db.store.map(r => r.ticker)).toEqual(['CCCD'])
  })

  it('S1.6 skips a stale feed: identical (close, volume) for every ticker vs latest stored', async () => {
    const prior = [
      { ticker: 'AERBD', price_date: '2026-10-15', close: 101, volume: 100 },
      { ticker: 'MGCRD', price_date: '2026-10-15', close: 97, volume: 100 },
    ]
    mockFetch.mockResolvedValue([row('AERBD', 101, 100), row('MGCRD', 97, 100)])
    const db = fakeSupabase(prior)
    expect(await captureOnPriceHistory(db.client, '2026-10-16')).toBe(0)
    expect(db.upserts).toHaveLength(0)
  })

  it('S1.6 writes when any ticker moved, and keeps raw c when v=0', async () => {
    const prior = [
      { ticker: 'AERBD', price_date: '2026-10-15', close: 101, volume: 100 },
      { ticker: 'MGCRD', price_date: '2026-10-15', close: 97, volume: 100 },
    ]
    mockFetch.mockResolvedValue([row('AERBD', 101, 100), row('MGCRD', 97.5, 0)])
    const db = fakeSupabase(prior)
    expect(await captureOnPriceHistory(db.client, '2026-10-16')).toBe(2)
    expect(db.store.find(r => r.ticker === 'MGCRD' && r.price_date === '2026-10-16')!.close).toBe(97.5)
  })

  it('upserts in chunks of 500', async () => {
    mockFetch.mockResolvedValue(Array.from({ length: 1100 }, (_, i) => row(`T${i}D`, 10 + i)))
    const db = fakeSupabase()
    await captureOnPriceHistory(db.client, '2026-10-16')
    expect(db.upserts.map(u => u.rows.length)).toEqual([500, 500, 100])
  })

  it('throws when the upsert errors so the caller can alert', async () => {
    mockFetch.mockResolvedValue([row('AERBD', 101)])
    const db = fakeSupabase()
    db.client.from = () => ({
      select: () => ({ lt: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }),
      upsert: async () => ({ error: { message: 'rls' } }),
    })
    await expect(captureOnPriceHistory(db.client, '2026-10-16')).rejects.toThrow('rls')
  })
})

describe('data912 `c` is a DIRTY price (task 1c.3)', () => {
  it('records the finding: downstream must not add accrued interest to c', () => {
    expect(DATA912_C_IS_DIRTY).toBe(true)
  })
})
