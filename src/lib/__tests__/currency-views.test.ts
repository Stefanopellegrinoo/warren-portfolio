/**
 * currencyViewsFor with the ledger the caller already read (/api/positions on a summary miss)
 * builds the same views as reading it again, and its own reads run together.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Quote } from '@/types'

const h = vi.hoisted(() => ({ market: null as any }))
vi.mock('@/lib/supabase-server', () => ({ createServiceClient: () => h.market }))
const local = new Map<string, Quote>([['local:AAPL', { ticker: 'AAPL', price: 28_420, change: 0, changePercent: 0.0121, previousClose: 28_420 }]])
const mockFetchQuotes = vi.fn(async (keys: string[]) => new Map(keys.filter(k => local.has(k)).map(k => [k, local.get(k)!])))
vi.mock('../yahoo-finance', () => ({ fetchQuotes: (keys: string[]) => mockFetchQuotes(keys) }))
const mockLoadSchedules = vi.fn(async () => new Map())
vi.mock('../on-schedules', () => ({ loadSchedules: (...a: unknown[]) => mockLoadSchedules(...(a as [])) }))

const { currencyViewsFor } = await import('../currency-views')

/** Chainable PostgREST stand-in: eq filters apply; `hold` delays one table's answer. */
function db(tables: Record<string, Record<string, unknown>[]>, log: string[] = [], hold?: { table: string; gate: Promise<void> }) {
  return {
    from(table: string) {
      log.push(table)
      const filters: Record<string, unknown> = {}
      const result = async () => {
        if (hold?.table === table) await hold.gate
        return { data: (tables[table] ?? []).filter(r => Object.entries(filters).every(([k, v]) => !(k in r) || r[k] === v)), error: null }
      }
      const q: Record<string, unknown> = {}
      for (const m of ['select', 'order', 'gte', 'lte', 'limit']) q[m] = () => q
      q.eq = (col: string, val: unknown) => { filters[col] = val; return q }
      q.range = () => result()
      q.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => result().then(ok, ko)
      return q
    },
  } as any
}

const row = (over: Record<string, unknown>) => ({
  user_id: 'u1', ticker: 'AAPL', date: '2026-05-04', created_at: '2026-05-04T12:00:00Z', operation: 'COMPRA', asset_type: 'CEDEAR',
  quantity: 0.5, price: 320, commission: 0, trade_currency: 'ARS', trade_quantity: 10, trade_price: 20_000, trade_commission: 0,
  fx_mep: 1000, fx_ccl: 1250, ...over,
})
// In date order, as the database serves them to the views' own read.
const byDate = [
  row({}),
  row({ ticker: 'KO', asset_type: 'ACCION', date: '2026-05-06', created_at: '2026-05-06T10:00:00Z', quantity: 1, price: 60,
    trade_currency: null, trade_quantity: null, trade_price: null, trade_commission: null, fx_mep: null, fx_ccl: null }),
  row({ operation: 'DIVIDENDO', date: '2026-05-10', created_at: '2026-05-10T10:00:00Z', quantity: 0, price: 0.3,
    trade_quantity: null, trade_price: 600, fx_mep: 1010, fx_ccl: 1260 }),
  row({ operation: 'DIVIDENDO', date: '2026-05-10', created_at: '2026-05-11T09:00:00Z', quantity: 0, price: 0.1,
    trade_quantity: null, trade_price: 200, fx_mep: 1010, fx_ccl: 1260 }),
]
const tables = {
  transactions: byDate,
  on_payment_overrides: [],
  fx_rates: [{ date: '2026-05-05', kind: 'mep', buy: 1000, sell: 1000 }, { date: '2026-05-05', kind: 'ccl', buy: 1250, sell: 1250 }],
}
const ctx = { fx: { mep: { rate: 1500, date: '2026-10-21' }, ccl: { rate: 1600, date: '2026-10-21' } }, ratios: new Map([['AAPL', 20]]) }
const valued = {
  positions: [{ ticker: 'AAPL', quantity: 0.5, market_value: 130, day_change_pct: 0.01 }, { ticker: 'KO', quantity: 1, market_value: 70 }],
  onPositions: [],
  cashBalance: 100,
}

beforeEach(() => vi.clearAllMocks())

describe('currencyViewsFor', () => {
  it('with the ledger already loaded (in id order) builds the same views without reading it again', async () => {
    h.market = db(tables)
    const read = await currencyViewsFor(db(tables), 'u1', ctx, valued)

    const log: string[] = []
    const sb = db(tables, log)
    h.market = sb
    // The ledger core reads by id: the KO row was entered last.
    const idOrder = [byDate[0], byDate[2], byDate[3], byDate[1]]
    const preloaded = await currencyViewsFor(sb, 'u1', ctx, valued, { trades: idOrder as never, overrides: [], schedules: new Map(), splits: new Map() })

    expect(preloaded).toEqual(read)
    expect(read.positions.KO.cost).toEqual({ ARS: 75_000, MEP: 75, CCL: 60 })
    expect(log).not.toContain('transactions')
    expect(log).not.toContain('on_payment_overrides')
    expect(mockLoadSchedules).toHaveBeenCalledTimes(1) // the first call only
  })

  it('asks the trade-date FX, the peso prices and the ON payments together', async () => {
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const log: string[] = []
    const sb = db(tables, log, { table: 'fx_rates', gate })
    h.market = sb

    const pending = currencyViewsFor(sb, 'u1', ctx, valued)
    // fx_rates has not answered yet: the peso prices, the overrides and the schedules are asked for.
    await vi.waitFor(() => {
      expect(log).toContain('fx_rates')
      expect(mockFetchQuotes).toHaveBeenCalledTimes(1)
      expect(log).toContain('on_payment_overrides')
      expect(mockLoadSchedules).toHaveBeenCalledTimes(1)
    })
    release()

    expect((await pending).positions.KO.cost).toEqual({ ARS: 75_000, MEP: 75, CCL: 60 })
  })
})

describe('loadPortfolioForViews keeps the user guard of getFullPortfolio', () => {
  it('refuses to read a ledger without a user id', async () => {
    const { loadPortfolioForViews } = await import('../currency-views')
    const from = vi.fn()

    await expect(loadPortfolioForViews({ from } as never, '', '2026-10-24')).rejects.toThrow('[Security]')
    expect(from).not.toHaveBeenCalled()
  })
})
