import { describe, it, expect } from 'vitest'
import { reconcileLedger } from '../ledger-reconciliation'

type Row = Record<string, unknown>
const USER = '00000000-0000-4000-8000-000000000001'

/** Minimal PostgREST stand-in: honours eq/order/range, serves rows per table. */
function fakeClient(tables: Record<string, Row[]>, failOn?: string) {
  const calls: Array<{ table: string; from: number; to: number; orders: string[] }> = []
  return {
    calls,
    from(table: string) {
      const q = { orders: [] as string[], from: 0, to: 0 }
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        order: (col: string) => { q.orders.push(col); return chain },
        range: (from: number, to: number) => {
          calls.push({ table, from, to, orders: [...q.orders] })
          if (table === failOn) return Promise.resolve({ data: null, error: { message: 'boom' } })
          return Promise.resolve({ data: (tables[table] ?? []).slice(from, to + 1), error: null })
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

  it('throws on a read error instead of passing', async () => {
    await expect(reconcileLedger(fakeClient(base(), 'on_positions'), USER, '2026-02-01')).rejects.toThrow(/boom/)
  })
})
