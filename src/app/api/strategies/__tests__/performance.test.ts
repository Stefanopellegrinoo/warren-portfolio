import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockRequireUser = vi.fn()
vi.mock('@/lib/api-auth', () => ({ requireUser: () => mockRequireUser(), isAuthFailure: (r: any) => 'error' in r }))

const { GET } = await import('../[id]/performance/route')

/** A fake user client: one answer per table; records the columns and orders asked. */
function fakeSupabase(tables: Record<string, unknown>) {
  const asked: { table: string; select?: string; order?: string }[] = []
  return {
    asked,
    client: {
      from(table: string) {
        const call: (typeof asked)[number] = { table }
        asked.push(call)
        const q: any = {
          select: (cols: string) => { call.select = cols; return q },
          eq: () => q,
          order: (col: string) => { call.order = col; return q },
          single: () => Promise.resolve({ data: tables[table] ?? null, error: null }),
          then: (ok: (r: unknown) => void) => ok({ data: tables[table] ?? [], error: null }),
        }
        return q
      },
    },
  }
}

const req = () => new NextRequest('http://x/api/strategies/s1/performance')
const SETUPS = [{ id: 'u1', name: 'Cruce EMA', active: true }, { id: 'u2', name: 'RSI', active: false }]

beforeEach(() => mockRequireUser.mockReset())

describe('GET /api/strategies/[id]/performance (odd/tasks/rendimiento.md S9)', () => {
  it('answers what the page shows of the strategy (name, tickers, setups in creation order), so the page does not ask for it', async () => {
    const { client, asked } = fakeSupabase({
      strategies: { id: 's1', name: 'Momentum', tickers: ['AAPL', 'MSFT'] },
      indicator_setups: SETUPS,
      setup_performance: [{ setup_id: 'u2', ticker: 'AAPL', total_trades: 4, profitable_trades: 3, avg_return_pct: 2, avg_duration_days: 5 }],
      paper_trades: [],
    })
    mockRequireUser.mockResolvedValue({ supabase: client, user: { id: 'user' } })
    const res = await GET(req(), { params: { id: 's1' } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.strategy).toEqual({ id: 's1', name: 'Momentum', tickers: ['AAPL', 'MSFT'], setups: SETUPS })
    // The comparison itself is unchanged: sorted by hit rate, the best one named.
    expect(body.setups.map((s: { setup_id: string }) => s.setup_id)).toEqual(['u2', 'u1'])
    expect(body.best_setup_id).toBe('u2')
    expect(asked.find(a => a.table === 'indicator_setups')!.order).toBe('created_at')
  })

  it('a strategy that is not the user\'s is 404', async () => {
    mockRequireUser.mockResolvedValue({ supabase: fakeSupabase({}).client, user: { id: 'user' } })
    expect((await GET(req(), { params: { id: 's1' } })).status).toBe(404)
  })
})
