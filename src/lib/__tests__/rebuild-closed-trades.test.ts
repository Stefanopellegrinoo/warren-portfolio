import { describe, it, expect } from 'vitest'
import { rebuildClosedTrades } from '../portfolio-engine'
import { rebuildONClosedTrades } from '../on-engine'

// ── Fake Supabase ────────────────────────────────────────────────────────────
// Records every builder chain so tests can assert WHICH statements ran,
// not just that the math came out right.

interface QueryCall {
  table: string
  ops: Array<[string, ...unknown[]]>
}

function fakeSupabase(transactions: unknown[]) {
  const calls: QueryCall[] = []
  return {
    calls,
    from(table: string) {
      const entry: QueryCall = { table, ops: [] }
      calls.push(entry)
      const q: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'order', 'delete', 'upsert', 'not', 'is']) {
        q[m] = (...args: unknown[]) => {
          entry.ops.push([m, ...args])
          return q
        }
      }
      q.then = (onFulfilled: (v: unknown) => unknown) => {
        const isSelect = entry.ops.some(([m]) => m === 'select')
        const result = isSelect ? { data: transactions, error: null } : { error: null }
        return Promise.resolve(result).then(onFulfilled)
      }
      return q
    },
  }
}

function opsOf(calls: QueryCall[], table: string, op: string): QueryCall[] {
  return calls.filter((c) => c.table === table && c.ops.some(([m]) => m === op))
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('rebuildClosedTrades — stale row cleanup (edited transactions)', () => {
  it('deletes closed_trades rows whose transaction is no longer a VENTA', async () => {
    // Arrange — t2 is a real VENTA; any row keyed to another tx id is stale
    const txs = [
      { id: 't1', date: '2026-01-01', operation: 'COMPRA', quantity: 10, price: 100, commission: 0 },
      { id: 't2', date: '2026-02-01', operation: 'VENTA', quantity: 5, price: 120, commission: 0 },
    ]
    const supabase = fakeSupabase(txs)

    // Act
    await rebuildClosedTrades(supabase as never, 'u1', 'AAPL')

    // Assert — a cleanup DELETE scoped to user+ticker, keeping only t2
    const deletes = opsOf(supabase.calls, 'closed_trades', 'delete')
    expect(deletes.length).toBeGreaterThan(0)
    // Two DELETEs run: unlinked rows first, then the stale-key cleanup. Pick by
    // intent rather than position so reordering them does not silently pass.
    const cleanup = deletes.find(d => d.ops.some(([m]) => m === 'not'))!
    expect(cleanup).toBeDefined()
    expect(cleanup.ops).toContainEqual(['eq', 'user_id', 'u1'])
    expect(cleanup.ops).toContainEqual(['eq', 'ticker', 'AAPL'])
    expect(cleanup.ops).toContainEqual(['not', 'transaction_id', 'in', '(t2)'])

    const unlinked = deletes.find(d => d.ops.some(([m]) => m === 'is'))!
    expect(unlinked).toBeDefined()
    expect(unlinked.ops).toContainEqual(['is', 'transaction_id', null])

    // ...and the VENTA row is still upserted
    const upserts = opsOf(supabase.calls, 'closed_trades', 'upsert')
    expect(upserts).toHaveLength(1)
    const [rows] = upserts[0].ops.find(([m]) => m === 'upsert')!.slice(1) as [any[]]
    expect(rows).toHaveLength(1)
    expect(rows[0].transaction_id).toBe('t2')
  })

  it('deletes ALL closed_trades for the ticker when no VENTA remains (edited VENTA→COMPRA)', async () => {
    // Arrange — the audit bug: the only VENTA was edited into a COMPRA.
    // Its closed_trades row survived every rebuild as phantom realized P&L.
    const txs = [
      { id: 't1', date: '2026-01-01', operation: 'COMPRA', quantity: 10, price: 100, commission: 0 },
    ]
    const supabase = fakeSupabase(txs)

    // Act
    await rebuildClosedTrades(supabase as never, 'u1', 'AAPL')

    // Assert — full cleanup for the ticker, no upsert
    const deletes = opsOf(supabase.calls, 'closed_trades', 'delete')
    expect(deletes.length).toBeGreaterThan(0)
    expect(deletes[0].ops).toContainEqual(['eq', 'ticker', 'AAPL'])
    expect(opsOf(supabase.calls, 'closed_trades', 'upsert')).toHaveLength(0)
  })
})

describe('rebuildONClosedTrades — same cleanup for ONs', () => {
  it('deletes on_closed_trades rows whose transaction is no longer a VENTA', async () => {
    // Arrange
    const txs = [
      { id: 'o1', date: '2026-01-01', operation: 'COMPRA', quantity: 100, price: 100, commission: 0 },
      { id: 'o2', date: '2026-03-01', operation: 'VENTA', quantity: 50, price: 104, commission: 0 },
    ]
    const supabase = fakeSupabase(txs)

    // Act
    await rebuildONClosedTrades(supabase as never, 'u1', 'MGCRD')

    // Assert
    const deletes = opsOf(supabase.calls, 'on_closed_trades', 'delete')
    expect(deletes.length).toBeGreaterThan(0)
    const cleanup = deletes.find(d => d.ops.some(([m]) => m === 'not'))!
    expect(cleanup).toBeDefined()
    expect(cleanup.ops).toContainEqual(['not', 'transaction_id', 'in', '(o2)'])

    const unlinked = deletes.find(d => d.ops.some(([m]) => m === 'is'))!
    expect(unlinked).toBeDefined()
    expect(unlinked.ops).toContainEqual(['is', 'transaction_id', null])
  })

  it('deletes ALL on_closed_trades for the ticker when no VENTA remains', async () => {
    // Arrange
    const txs = [
      { id: 'o1', date: '2026-01-01', operation: 'COMPRA', quantity: 100, price: 100, commission: 0 },
    ]
    const supabase = fakeSupabase(txs)

    // Act
    await rebuildONClosedTrades(supabase as never, 'u1', 'MGCRD')

    // Assert
    const deletes = opsOf(supabase.calls, 'on_closed_trades', 'delete')
    expect(deletes.length).toBeGreaterThan(0)
    expect(opsOf(supabase.calls, 'on_closed_trades', 'upsert')).toHaveLength(0)
  })
})
