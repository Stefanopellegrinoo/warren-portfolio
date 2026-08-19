import { describe, it, expect, vi } from 'vitest'
import { retroactiveWarnings } from '../retroactive-warning'

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Chainable fake modeling `fetchSnapshotSeries`'s real pagination — same shape
 * as `src/lib/__tests__/snapshot-series.test.ts`. Serving one page per
 * `.range()` call is what makes the OLD unpaginated read (a plain `.select()`
 * with no `.range()`, resolved off a single `.order()` call) fail the
 * multi-page test below with a truncated series instead of a TypeError: a
 * `.order()` with no `.range()` after it would only ever see `nextPage()`
 * called once, via `.range()` never being invoked.
 */
function fakeSupabase(...pages: Array<{ data: unknown; error: unknown }>) {
  const calls: Record<string, unknown[][]> = { eq: [], gte: [], order: [], range: [] }
  let served = 0
  const nextPage = () => pages[served++] ?? { data: [], error: null }

  const build = () => {
    const q: Record<string, (...args: unknown[]) => unknown> = {}
    q.eq = (...a: unknown[]) => { calls.eq.push(a); return q }
    q.gte = (...a: unknown[]) => { calls.gte.push(a); return q }
    q.order = (...a: unknown[]) => { calls.order.push(a); return q }
    q.range = (...a: unknown[]) => { calls.range.push(a); return Promise.resolve(nextPage()) }
    return q
  }

  const from = vi.fn(() => ({ select: vi.fn(() => build()) }))
  return { supabase: { from } as any, from, calls } // eslint-disable-line @typescript-eslint/no-explicit-any
}

// Base year picked deliberately far in the past so "now" (real wall-clock
// time, whenever this suite runs) is always after every fixture date without
// having to reason about the current date.
const day = (i: number) => new Date(Date.UTC(2020, 0, 1) + i * 86_400_000).toISOString().slice(0, 10)
const estimatedRow = (i: number) => ({ snapshot_date: day(i), source: 'estimated' as const })

// ── Tests ────────────────────────────────────────────────────────────────────

describe('retroactiveWarnings', () => {
  it('still fires when the live row sits in a page past PostgREST\'s 1000-row cap', async () => {
    // THE regression this file exists to pin. `retroactive-warning.ts` used to
    // run its own unpaginated `.select()`, ascending by snapshot_date. That
    // truncates the newest rows at the 1000-row cap -- exactly the `live` ones,
    // because the `estimated` rows are the old backfilled span. A user with
    // more than 1000 snapshots at-or-after `entryDate` would have gotten page
    // 1 only, all `estimated`, and `staleSnapshots` would have silently
    // returned `[]` while every test in the suite (which feeds one row) stayed
    // green.
    const firstPage = Array.from({ length: 1000 }, (_, i) => estimatedRow(i))
    // The live row is on the SECOND page -- later in the series than the
    // entire first page.
    const liveDate = day(1005)
    const secondPage = [
      ...Array.from({ length: 4 }, (_, i) => estimatedRow(1000 + i)),
      { snapshot_date: liveDate, source: 'live' as const },
    ]

    const { supabase, calls } = fakeSupabase(
      { data: firstPage, error: null },
      { data: secondPage, error: null }
    )

    const entryDate = day(0)
    const result = await retroactiveWarnings(supabase, 'u1', entryDate)

    expect(result).toEqual([
      { code: 'RETROACTIVE_ENTRY', entryDate, staleSnapshots: [liveDate] },
    ])
    // Proves both pages were actually walked -- the failure mode this test
    // guards is silent truncation, not a thrown error, so asserting only the
    // result would not distinguish "paginated correctly" from "got lucky".
    expect(calls.range).toEqual([[0, 999], [1000, 1999]])
  })

  it('returns no warning when nothing is stale', async () => {
    const { supabase } = fakeSupabase({ data: [], error: null })

    const result = await retroactiveWarnings(supabase, 'u1', '2020-07-02')

    expect(result).toEqual([])
  })

  it('never throws -- a failing read returns no warnings', async () => {
    const { supabase } = fakeSupabase({ data: null, error: { message: 'connection reset' } })

    const result = await retroactiveWarnings(supabase, 'u1', '2020-07-02')

    expect(result).toEqual([])
  })
})
