import { describe, it, expect, vi } from 'vitest'
import { fetchSnapshotSeries } from '../snapshot-series'

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Chainable fake capturing eq/gte/lte/order/range arguments, serving one page
 * per `.range()` call.
 *
 * `.order()` is deliberately awaitable on its own and resolves to the FIRST
 * page — exactly how PostgREST behaves when nobody paginates: the query is
 * valid, it just silently stops at the 1000-row cap. That is what makes an
 * unpaginated implementation fail the multi-page test with a short series
 * rather than with a TypeError.
 */
function fakeSupabase(...pages: Array<{ data: any; error: any }>) {
  const calls: Record<string, any[][]> = { eq: [], gte: [], lte: [], order: [], range: [] }
  let served = 0
  const nextPage = () => pages[served++] ?? { data: [], error: null }

  const build = () => {
    const q: any = {
      eq: (...a: any[]) => { calls.eq.push(a); return q },
      gte: (...a: any[]) => { calls.gte.push(a); return q },
      lte: (...a: any[]) => { calls.lte.push(a); return q },
      range: (...a: any[]) => { calls.range.push(a); return Promise.resolve(nextPage()) },
      order: (...a: any[]) => {
        calls.order.push(a)
        return { ...q, then: (resolve: any) => resolve(pages[0] ?? { data: [], error: null }) }
      },
    }
    return q
  }

  const from = vi.fn(() => ({ select: vi.fn(() => build()) }))
  return { supabase: { from } as any, from, calls }
}

const ROWS = [
  { id: '1', user_id: 'u1', snapshot_date: '2026-07-20', total_value: 1000, total_invested: 900, pnl: 100, pnl_pct: 100 / 900 },
  { id: '2', user_id: 'u1', snapshot_date: '2026-07-21', total_value: 1100, total_invested: 900, pnl: 200, pnl_pct: 200 / 900 },
]

// ── Tests ────────────────────────────────────────────────────────────────────

describe('fetchSnapshotSeries', () => {
  it('reads portfolio_snapshots for the user, ordered ascending by snapshot_date', async () => {
    // Arrange
    const { supabase, from, calls } = fakeSupabase({ data: ROWS, error: null })

    // Act
    const rows = await fetchSnapshotSeries(supabase, 'u1')

    // Assert
    expect(from).toHaveBeenCalledWith('portfolio_snapshots')
    expect(calls.eq[0]).toEqual(['user_id', 'u1'])
    expect(calls.order[0]).toEqual(['snapshot_date', { ascending: true }])
    expect(rows).toEqual(ROWS)
  })

  it('applies an inclusive date range only when given', async () => {
    // Arrange
    const { supabase, calls } = fakeSupabase({ data: [], error: null })

    // Act
    await fetchSnapshotSeries(supabase, 'u1', { fromDate: '2026-07-01', toDate: '2026-07-21' })

    // Assert
    expect(calls.gte[0]).toEqual(['snapshot_date', '2026-07-01'])
    expect(calls.lte[0]).toEqual(['snapshot_date', '2026-07-21'])
  })

  it('adds no range filters when the range is omitted', async () => {
    // Arrange
    const { supabase, calls } = fakeSupabase({ data: [], error: null })

    // Act
    await fetchSnapshotSeries(supabase, 'u1')

    // Assert
    expect(calls.gte).toHaveLength(0)
    expect(calls.lte).toHaveLength(0)
  })

  it('returns an empty array when there are no snapshots', async () => {
    // Arrange
    const { supabase } = fakeSupabase({ data: null, error: null })

    // Act + Assert
    await expect(fetchSnapshotSeries(supabase, 'u1')).resolves.toEqual([])
  })

  it('throws on a failed read instead of returning a silent empty series', async () => {
    // Arrange
    const { supabase } = fakeSupabase({ data: null, error: { message: 'rls denied' } })

    // Act + Assert
    await expect(fetchSnapshotSeries(supabase, 'u1')).rejects.toThrow('rls denied')
  })

  it('returns a series longer than 1000 rows COMPLETE and in order', async () => {
    // The snapshot backfill writes ~1123 rows per user — this is exactly what
    // first pushes a user past PostgREST's 1000-row cap. Unpaginated, /statistics
    // would receive the OLDEST 1000 and silently drop the newest ~120 days,
    // including every measured row, while presenting as current.
    //
    // Arrange
    const day = (i: number) => new Date(Date.UTC(2022, 1, 9) + i * 86_400_000).toISOString().slice(0, 10)
    const row = (i: number) => ({ id: String(i), user_id: 'u1', snapshot_date: day(i), total_value: 1000 + i })
    const first = Array.from({ length: 1000 }, (_, i) => row(i))
    const second = Array.from({ length: 123 }, (_, i) => row(1000 + i))

    const { supabase, calls } = fakeSupabase(
      { data: first, error: null },
      { data: second, error: null }
    )

    // Act
    const rows = await fetchSnapshotSeries(supabase, 'u1')

    // Assert
    expect(rows).toHaveLength(1123)
    expect(rows[0].snapshot_date).toBe(day(0))
    expect(rows[1122].snapshot_date).toBe(day(1122))
    expect(rows.map(r => r.snapshot_date)).toEqual([...rows.map(r => r.snapshot_date)].sort())
    expect(calls.range).toEqual([[0, 999], [1000, 1999]])
    // Every page must carry the same ordering, or the pages do not concatenate.
    expect(calls.order).toEqual([
      ['snapshot_date', { ascending: true }],
      ['snapshot_date', { ascending: true }],
    ])
  })

  it('stops after a short page instead of walking forever', async () => {
    // Arrange
    const { supabase, calls } = fakeSupabase({ data: ROWS, error: null })

    // Act
    const rows = await fetchSnapshotSeries(supabase, 'u1')

    // Assert
    expect(rows).toHaveLength(2)
    expect(calls.range).toHaveLength(1)
  })

  it('re-applies the date range on every page', async () => {
    // A range filter dropped on page 2 would splice unfiltered rows onto a
    // filtered head.
    // Arrange
    const bulk = Array.from({ length: 1000 }, (_, i) => ({ id: String(i), user_id: 'u1', snapshot_date: '2026-07-20' }))
    const { supabase, calls } = fakeSupabase({ data: bulk, error: null }, { data: [], error: null })

    // Act
    await fetchSnapshotSeries(supabase, 'u1', { fromDate: '2022-01-01', toDate: '2026-07-21' })

    // Assert
    expect(calls.gte).toHaveLength(2)
    expect(calls.lte).toHaveLength(2)
    expect(calls.eq).toEqual([['user_id', 'u1'], ['user_id', 'u1']])
  })
})
