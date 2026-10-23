import { describe, it, expect } from 'vitest'
import { loadSchedules } from '../on-schedules'

type Row = Record<string, unknown>

/** PostgREST stand-in: honours in/order, serves rows per table. */
function fakeClient(tables: Record<string, Row[]>, failOn?: string) {
  return {
    from(table: string) {
      const q: { col?: string; vals?: unknown[] } = {}
      const chain: any = {
        select: () => chain,
        or: (expr: string) => {
          const vals = [...expr.matchAll(/ticker_[odc]\.in\.\(([^)]*)\)/g)].flatMap(m => m[1].split(','))
          q.col = 'tickers'; q.vals = vals
          return chain
        },
        in: (col: string, vals: unknown[]) => { q.col = col; q.vals = vals; return chain },
        order: () => chain,
        then: (resolve: (v: unknown) => void) => {
          if (table === failOn) return resolve({ data: null, error: { message: 'boom' } })
          const rows = (tables[table] ?? []).filter(r => q.col === 'tickers'
            ? q.vals!.includes(r.ticker_d) || q.vals!.includes(r.ticker_c) || q.vals!.includes(r.ticker_o)
            : q.vals!.includes(r[q.col!]))
          resolve({ data: rows, error: null })
        },
      }
      return chain
    },
  } as any
}

const tables = {
  on_terms: [{ isin: 'AR1', ticker_o: 'YM42O', ticker_d: 'YM42D', ticker_c: 'YM42C' }],
  on_flow_history: [
    { isin: 'AR1', flow_date: '2026-06-02', ren: 3.49, amo: 0, first_seen_as_of: '2026-10-22', last_seen_as_of: '2026-10-22', source: 'bonistas' },
    { isin: 'AR1', flow_date: '2026-12-01', ren: 3.49, amo: 0, first_seen_as_of: '2026-10-20', last_seen_as_of: '2026-10-21', source: 'byma_educa' },
  ],
  on_cashflows: [{ isin: 'AR1', flow_date: '2026-12-01', ren: 3.5, amo: 0 }],
}

describe('loadSchedules', () => {
  it('merges every source per held ticker: past reports and future BYMA flows', async () => {
    const s = await loadSchedules(fakeClient(tables), ['YM42D'], '2026-10-22')
    expect(s.get('YM42D')).toEqual([
      { date: '2026-06-02', ren: 3.49, amo: 0 },
      { date: '2026-12-01', ren: 3.5, amo: 0 },
    ])
  })

  it('a ticker with no terms gets no schedule (its payments are asked from the user)', async () => {
    const s = await loadSchedules(fakeClient(tables), ['ZZZZD'], '2026-10-22')
    expect(s.has('ZZZZD')).toBe(false)
  })

  it('throws on a read failure: a partial schedule is worse than none', async () => {
    await expect(loadSchedules(fakeClient(tables, 'on_flow_history'), ['YM42D'], '2026-10-22')).rejects.toThrow(/on_flow_history/)
  })
})
