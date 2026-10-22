import { describe, it, expect } from 'vitest'
import { reconcileLedger } from '../ledger-reconciliation'

type Row = Record<string, unknown>
const USER = '00000000-0000-4000-8000-000000000001'

/** Minimal PostgREST stand-in: honours eq/order/range, serves rows per table. */
function fakeClient(
  tables: Record<string, Row[]>,
  failOn?: string,
  /** Served instead of `tables[table]` the first time that table is read (a write landed mid-reconcile). */
  firstRead: Record<string, Row[]> = {},
) {
  const calls: Array<{ table: string; from: number; to: number; orders: string[]; eqs: Array<[string, unknown]>; columns: string }> = []
  const reads = new Map<string, number>()
  return {
    calls,
    from(table: string) {
      const q = { orders: [] as string[], from: 0, to: 0, eqs: [] as Array<[string, unknown]>, columns: '' }
      const nth = reads.get(table) ?? 0
      const chain: any = {
        select: (cols: string) => { q.columns = cols; return chain },
        eq: (col: string, val: unknown) => { q.eqs.push([col, val]); return chain },
        order: (col: string) => { q.orders.push(col); return chain },
        range: (from: number, to: number) => {
          calls.push({ table, from, to, orders: [...q.orders], eqs: [...q.eqs], columns: q.columns })
          if (from === 0) reads.set(table, nth + 1)
          if (table === failOn) return Promise.resolve({ data: null, error: { message: 'boom' } })
          const source = nth === 0 && table in firstRead ? firstRead[table] : tables[table] ?? []
          return Promise.resolve({ data: source.slice(from, to + 1), error: null })
        },
      }
      return chain
    },
  } as any
}

const buy = (ticker: string, qty: number, price: number, asset_type = 'ACCION') => ({
  ticker, operation: 'COMPRA', quantity: qty, price, commission: 0, date: '2026-01-05',
  asset_type, created_at: '2026-01-05T12:00:00Z',
})

const base = (): Record<string, Row[]> => ({
  transactions: [buy('AAA', 10, 5), buy('ONX', 100, 2, 'ON')],
  cash_movements: [
    { type: 'DEPOSITO', amount: 1000, date: '2026-01-01' },
    { type: 'COMPRA', amount: 50, date: '2026-01-05' },
    { type: 'COMPRA', amount: 200, date: '2026-01-05' },
  ],
  positions: [{ ticker: 'AAA', quantity: 10, total_invested: 50 }],
  on_positions: [{ ticker: 'ONX', quantity: 100, total_invested: 200 }],
  cash_balance: [{ balance: 1000 - 50 - 200 }],
})

describe('reconcileLedger', () => {
  it('passes when the replay reproduces stored positions, ONs and cash', async () => {
    const r = await reconcileLedger(fakeClient(base()), USER, '2026-02-01')
    expect(r).toEqual({ ok: true, reasons: [] })
  })

  it('reports an ON mismatch', async () => {
    const t = base()
    t.on_positions = [{ ticker: 'ONX', quantity: 100, total_invested: 150 }]
    const r = await reconcileLedger(fakeClient(t), USER, '2026-02-01')
    expect(r.ok).toBe(false)
    expect(r.reasons.join('\n')).toMatch(/ON ONX: invested/)
  })

  it('reports a cash mismatch', async () => {
    const t = base()
    t.cash_balance = [{ balance: 999 }]
    const r = await reconcileLedger(fakeClient(t), USER, '2026-02-01')
    expect(r.ok).toBe(false)
    expect(r.reasons.join('\n')).toMatch(/cash:/)
  })

  it('paginates every table past 1000 rows, ordered by id', async () => {
    const t = base()
    t.cash_movements = [
      ...Array.from({ length: 1500 }, () => ({ type: 'DEPOSITO', amount: 1, date: '2026-01-01' })),
      { type: 'COMPRA', amount: 250, date: '2026-01-05' },
    ]
    t.cash_balance = [{ balance: 1500 - 250 }]
    const c = fakeClient(t)
    const r = await reconcileLedger(c, USER, '2026-02-01')
    expect(r.ok).toBe(true)
    const pages = c.calls.filter((x: any) => x.table === 'cash_movements')
    expect(pages.map((p: any) => p.from)).toEqual([0, 1000])
    expect(pages.every((p: any) => p.orders.includes('id'))).toBe(true)
  })

  it('scopes every table read to the user and selects the columns the replay needs', async () => {
    const c = fakeClient(base())
    await reconcileLedger(c, USER, '2026-02-01')
    const tables = new Set(c.calls.map((x: any) => x.table))
    expect(tables).toEqual(new Set(['transactions', 'cash_movements', 'positions', 'on_positions', 'cash_balance', 'closed_trades', 'on_closed_trades']))
    for (const call of c.calls) expect(call.eqs).toContainEqual(['user_id', USER])
    const tx = c.calls.find((x: any) => x.table === 'transactions')
    expect(tx.columns).toContain('created_at')
  })

  it('compares realized P&L per ticker against the stored closed trades', async () => {
    const t = base()
    t.transactions = [...t.transactions, { ...buy('AAA', 4, 8), operation: 'VENTA', quantity: -4, created_at: '2026-01-06T12:00:00Z', date: '2026-01-06' }]
    t.cash_movements = [...t.cash_movements, { type: 'VENTA', amount: 32, date: '2026-01-06' }]
    t.positions = [{ ticker: 'AAA', quantity: 6, total_invested: 30 }]
    t.cash_balance = [{ balance: 1000 - 50 - 200 + 32 }]
    t.closed_trades = [{ ticker: 'AAA', invested: 20, proceeds: 32 }]
    expect(await reconcileLedger(fakeClient(t), USER, '2026-02-01')).toEqual({ ok: true, reasons: [] })
    t.closed_trades = [{ ticker: 'AAA', invested: 20, proceeds: 40 }]
    expect((await reconcileLedger(fakeClient(t), USER, '2026-02-01')).reasons).toEqual(['realized AAA: 12.00 replayed vs 20.00 stored'])
  })

  it('reports an oversell in the ledger instead of passing it silently', async () => {
    const t = base()
    t.transactions = [...t.transactions, { ...buy('AAA', 12, 8), operation: 'VENTA', quantity: -12, created_at: '2026-01-06T12:00:00Z', date: '2026-01-06' }]
    const { reasons } = await reconcileLedger(fakeClient(t), USER, '2026-02-01')
    expect(reasons).toContain('oversell AAA on 2026-01-06: sold 12, held 10')
  })

  it('counts future-dated rows the stored state already includes (default cutoff)', async () => {
    const t = base()
    t.transactions = [...t.transactions, { ...buy('AAA', 5, 5), date: '2999-01-01' }]
    t.cash_movements = [...t.cash_movements, { type: 'COMPRA', amount: 25, date: '2999-01-01' }]
    t.positions = [{ ticker: 'AAA', quantity: 15, total_invested: 75 }]
    t.cash_balance = [{ balance: 1000 - 50 - 200 - 25 }]
    expect(await reconcileLedger(fakeClient(t), USER)).toEqual({ ok: true, reasons: [] })
  })

  it('re-reads once on a mismatch and stays quiet when the second read is consistent', async () => {
    const stale = [{ ticker: 'AAA', quantity: 99, total_invested: 50 }]
    const c = fakeClient(base(), undefined, { positions: stale })
    expect(await reconcileLedger(c, USER, '2026-02-01')).toEqual({ ok: true, reasons: [] })
  })

  it('still reports a mismatch that persists across the re-read', async () => {
    const t = base()
    t.positions = [{ ticker: 'AAA', quantity: 99, total_invested: 50 }]
    const r = await reconcileLedger(fakeClient(t), USER, '2026-02-01')
    expect(r.ok).toBe(false)
  })

  it('reports a stock quantity mismatch with the replayed and stored quantities', async () => {
    const t = base()
    t.positions = [{ ticker: 'AAA', quantity: 12, total_invested: 50 }]
    const r = await reconcileLedger(fakeClient(t), USER, '2026-02-01')
    expect(r.reasons).toEqual(['stock AAA: quantity 10 replayed vs 12 stored'])
  })

  it('treats a VENTA as signed: selling 4 of 10 expects 6 stored, 10 is a mismatch', async () => {
    const sell = { ticker: 'AAA', operation: 'VENTA', quantity: -4, price: 5, commission: 0, date: '2026-01-06', asset_type: 'ACCION', created_at: '2026-01-06T12:00:00Z' }
    const t = base()
    t.transactions = [...t.transactions, sell]
    t.cash_movements = [...t.cash_movements, { type: 'VENTA', amount: 20, date: '2026-01-06' }]
    t.cash_balance = [{ balance: 1000 - 50 - 200 + 20 }]
    t.positions = [{ ticker: 'AAA', quantity: 6, total_invested: 30 }]
    expect(await reconcileLedger(fakeClient(t), USER, '2026-02-01')).toEqual({ ok: true, reasons: [] })
    t.positions = [{ ticker: 'AAA', quantity: 10, total_invested: 30 }]
    const bad = await reconcileLedger(fakeClient(t), USER, '2026-02-01')
    expect(bad.reasons.join('\n')).toMatch(/AAA: quantity 6 replayed vs 10 stored/)
  })

  it('throws on a read error instead of passing', async () => {
    await expect(reconcileLedger(fakeClient(base(), 'on_positions'), USER, '2026-02-01')).rejects.toThrow(/boom/)
  })
})
