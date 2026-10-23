/**
 * A fake Supabase client for the ledger reads (odd/tasks/nucleo-ledger.md T4.2b).
 * It serves the given tables (eq filters applied, paged by `range`) and THROWS on
 * the stored derived tables, so a test using it proves the reader never touches them.
 */
export const STORED_TABLES = ['positions', 'on_positions', 'closed_trades', 'on_closed_trades', 'cash_balance']

export type FakeTables = Record<string, any[] | { error: { message: string } }>

export function ledgerSupabase(tables: FakeTables, log: string[] = []) {
  return {
    from(name: string) {
      log.push(name)
      if (STORED_TABLES.includes(name)) throw new Error(`stored table read: ${name}`)
      const cfg = tables[name] ?? []
      const eqs: [string, unknown][] = []
      let from = 0
      let to = Infinity
      const b: any = {
        select: () => b, order: () => b, gte: () => b, lte: () => b, in: () => b, or: () => b, gt: () => b, limit: () => b,
        eq: (c: string, v: unknown) => { eqs.push([c, v]); return b },
        range: (f: number, t: number) => { from = f; to = t; return b },
        then: (res: any, rej: any) => {
          if (!Array.isArray(cfg)) return Promise.resolve({ data: null, error: cfg.error }).then(res, rej)
          const rows = cfg.filter(r => eqs.every(([c, v]) => !(c in r) || r[c] === v))
          return Promise.resolve({ data: rows.slice(from, to + 1), error: null }).then(res, rej)
        },
      }
      return b
    },
  } as any
}

export const trade = (over: Record<string, unknown> = {}) => ({
  user_id: 'u1', ticker: 'AAPL', operation: 'COMPRA', quantity: 10, price: 100, commission: 0,
  date: '2026-01-05', asset_type: 'ACCION', created_at: null, ...over,
})

export const movement = (over: Record<string, unknown> = {}) => ({
  user_id: 'u1', type: 'DEPOSITO', amount: 1000, date: '2026-01-02', ...over,
})
