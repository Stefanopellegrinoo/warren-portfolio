import { describe, it, expect, vi, beforeEach } from 'vitest'

const cache = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }))
vi.mock('../redis', () => ({ getCachedRoute: cache.get, cacheRoute: cache.set }))
vi.mock('../supabase-server', () => ({ createServiceClient: vi.fn() }))

import { loadSplits, SPLITS_KEY } from '../stock-splits'

/** stock_splits served in pages of at most `cap` rows, whatever range is asked (PostgREST's row cap). */
function fakeDb(rows: unknown[] | null, error: unknown = null, cap = Infinity) {
  const range = vi.fn(async (f: number, t: number) => ({ data: rows && rows.slice(f, Math.min(t + 1, f + cap)), error }))
  const b: any = { select: vi.fn(() => b), order: vi.fn(() => b), range }
  return { client: { from: vi.fn(() => b) } as never, range }
}

describe('loadSplits (odd/tasks/split-aware-ledger.md T2)', () => {
  beforeEach(() => { cache.get.mockReset(); cache.set.mockReset() })

  it('reads the table once, groups by ledger ticker oldest first, and caches it', async () => {
    cache.get.mockResolvedValue(null)
    const db = fakeDb([
      { ticker: 'NVDA', date: '2021-07-20', numerator: '4', denominator: '1' },
      { ticker: 'GOOGL', date: '2022-07-18', numerator: '20', denominator: '1' },
      { ticker: 'NVDA', date: '2024-06-10', numerator: '10', denominator: '1' },
    ])
    const splits = await loadSplits(db.client)
    expect(splits.get('NVDA')).toEqual([
      { date: '2021-07-20', numerator: 4, denominator: 1 },
      { date: '2024-06-10', numerator: 10, denominator: 1 },
    ])
    expect(splits.get('GOOGL')).toEqual([{ date: '2022-07-18', numerator: 20, denominator: 1 }])
    expect(cache.set).toHaveBeenCalledWith(SPLITS_KEY, expect.any(Array), expect.any(Number))
  })

  it('serves the cached copy without reading the table', async () => {
    cache.get.mockResolvedValue([{ ticker: 'SONY', date: '2024-10-09', numerator: 5, denominator: 1 }])
    const db = fakeDb([])
    const splits = await loadSplits(db.client)
    expect(splits.get('SONY')).toEqual([{ date: '2024-10-09', numerator: 5, denominator: 1 }])
    expect(db.range).not.toHaveBeenCalled()
  })

  it('reads every page, however few rows a page holds', async () => {
    cache.get.mockResolvedValue(null)
    const rows = Array.from({ length: 5 }, (_, i) => ({ ticker: 'T' + i, date: '2024-01-0' + (i + 1), numerator: 2, denominator: 1 }))
    const splits = await loadSplits(fakeDb(rows, null, 2).client)
    expect([...splits.keys()].sort()).toEqual(['T0', 'T1', 'T2', 'T3', 'T4'])
  })

  it('an unreadable table throws instead of returning no splits', async () => {
    cache.get.mockResolvedValue(null)
    await expect(loadSplits(fakeDb(null, { message: 'boom' }).client)).rejects.toThrow(/stock_splits/)
    expect(cache.set).not.toHaveBeenCalled()
  })
})
