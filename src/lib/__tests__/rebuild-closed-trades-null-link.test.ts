import { describe, it, expect } from 'vitest'
import { rebuildClosedTrades } from '../portfolio-engine'
import { rebuildONClosedTrades } from '../on-engine'

/**
 * Every closed_trades row written by the bulk import carries transaction_id =
 * NULL. The rebuild's orphan cleanup filters with `NOT (transaction_id IN
 * (...))`, which in SQL is NULL — never TRUE — for a NULL transaction_id, so
 * those rows survive it. And UNIQUE(transaction_id) permits many NULLs, so the
 * upsert's ON CONFLICT does not see them either and INSERTS beside them.
 * Net effect: every rebuild of an imported ticker DOUBLES its realized P&L.
 *
 * The sibling suite (rebuild-closed-trades.test.ts) asserts WHICH statements
 * are issued against a call-recording fake. That fake never evaluates SQL, so
 * it is structurally blind to this: the statement it asserts on is exactly the
 * one that does not do what it looks like it does.
 *
 * The fake below therefore keeps a ROW STORE and evaluates the filters,
 * reproducing Postgres three-valued logic for NULL and the "NULLs never
 * conflict" behaviour of a UNIQUE index. These tests can fail.
 */

type Row = Record<string, any>

function semanticSupabase(opts: { transactions: Row[]; closedTrades?: Row[]; onClosedTrades?: Row[] }) {
  const store: Record<string, Row[]> = {
    closed_trades: [...(opts.closedTrades ?? [])],
    on_closed_trades: [...(opts.onClosedTrades ?? [])],
  }

  function from(table: string) {
    const eqs: Array<[string, unknown]> = []
    const notIns: Array<[string, string[]]> = []
    const isNulls: string[] = []
    let mode: 'select' | 'delete' | 'upsert' | null = null
    let upsertRows: Row[] = []

    /** A row matches only when every predicate is TRUE (SQL, not JS). */
    const matches = (row: Row): boolean => {
      for (const [col, val] of eqs) if (row[col] !== val) return false
      for (const col of isNulls) if (row[col] != null) return false
      for (const [col, ids] of notIns) {
        // NOT (NULL IN (...)) is NULL, which is not TRUE -> no match.
        if (row[col] == null) return false
        if (ids.includes(String(row[col]))) return false
      }
      return true
    }

    const run = () => {
      if (mode === 'select') return { data: opts.transactions, error: null }
      if (mode === 'delete') {
        store[table] = (store[table] ?? []).filter(r => !matches(r))
        return { data: null, error: null }
      }
      if (mode === 'upsert') {
        for (const row of upsertRows) {
          const key = row.transaction_id
          // UNIQUE allows many NULLs: a NULL key can never conflict.
          const existing = key == null
            ? -1
            : (store[table] ?? []).findIndex(r => r.transaction_id != null && r.transaction_id === key)
          if (existing >= 0) store[table][existing] = { ...store[table][existing], ...row }
          else (store[table] ??= []).push({ ...row })
        }
        return { data: null, error: null }
      }
      return { data: null, error: null }
    }

    const q: any = {
      select() { mode = 'select'; return q },
      delete() { mode = 'delete'; return q },
      upsert(rows: Row[]) { mode = 'upsert'; upsertRows = rows; return q },
      eq(col: string, val: unknown) { eqs.push([col, val]); return q },
      is(col: string, val: unknown) { if (val === null) isNulls.push(col); return q },
      not(col: string, op: string, list: string) {
        if (op === 'in') notIns.push([col, list.replace(/^\(|\)$/g, '').split(',').filter(Boolean)])
        return q
      },
      order() { return q },
      then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
        return Promise.resolve(run()).then(onFulfilled, onRejected)
      },
    }
    return q
  }

  return { from, store }
}

// ─────────────────────────────────────────────────────────────────────────────

describe('rebuildClosedTrades — import-era rows with no transaction link', () => {
  const TXS = [
    { id: 't1', date: '2023-01-10', operation: 'COMPRA', quantity: 10, price: 100, commission: 0 },
    { id: 't2', date: '2023-06-10', operation: 'VENTA', quantity: 10, price: 120, commission: 0 },
  ]
  /** What the bulk import left behind: same trade, no link. */
  const IMPORTED = {
    user_id: 'u1', ticker: 'AAPL', open_date: '2023-01-10', close_date: '2023-06-10',
    avg_cost: 100, close_price: 120, quantity: 10, invested: 1000, proceeds: 1200,
    transaction_id: null,
  }

  it('removes the unlinked row instead of inserting a duplicate beside it', async () => {
    // Arrange
    const supabase = semanticSupabase({ transactions: TXS, closedTrades: [IMPORTED] })

    // Act
    await rebuildClosedTrades(supabase as never, 'u1', 'AAPL')

    // Assert — one trade happened, so exactly one row may survive
    expect(supabase.store.closed_trades).toHaveLength(1)
    expect(supabase.store.closed_trades[0].transaction_id).toBe('t2')
  })

  it('does not double realized P&L', async () => {
    // Arrange
    const supabase = semanticSupabase({ transactions: TXS, closedTrades: [IMPORTED] })

    // Act
    await rebuildClosedTrades(supabase as never, 'u1', 'AAPL')

    // Assert
    const realized = supabase.store.closed_trades.reduce((s, r) => s + (r.proceeds - r.invested), 0)
    expect(realized).toBeCloseTo(200, 6)
  })

  it('is idempotent — rebuilding repeatedly never grows the table', async () => {
    // Arrange
    const supabase = semanticSupabase({ transactions: TXS, closedTrades: [IMPORTED] })

    // Act
    await rebuildClosedTrades(supabase as never, 'u1', 'AAPL')
    await rebuildClosedTrades(supabase as never, 'u1', 'AAPL')
    await rebuildClosedTrades(supabase as never, 'u1', 'AAPL')

    // Assert
    expect(supabase.store.closed_trades).toHaveLength(1)
  })

  it('keeps a row that IS linked to a current VENTA', async () => {
    // Arrange — the cleanup must not become indiscriminate
    const linked = { ...IMPORTED, transaction_id: 't2' }
    const supabase = semanticSupabase({ transactions: TXS, closedTrades: [linked] })

    // Act
    await rebuildClosedTrades(supabase as never, 'u1', 'AAPL')

    // Assert
    expect(supabase.store.closed_trades).toHaveLength(1)
    expect(supabase.store.closed_trades[0].transaction_id).toBe('t2')
  })

  it('leaves another ticker alone', async () => {
    // Arrange — scoping must survive the fix
    const other = { ...IMPORTED, ticker: 'MSFT' }
    const supabase = semanticSupabase({ transactions: TXS, closedTrades: [IMPORTED, other] })

    // Act
    await rebuildClosedTrades(supabase as never, 'u1', 'AAPL')

    // Assert
    const msft = supabase.store.closed_trades.filter(r => r.ticker === 'MSFT')
    expect(msft).toHaveLength(1)
    expect(msft[0].transaction_id).toBeNull()
  })

  it('leaves another user alone', async () => {
    // Arrange
    const otherUser = { ...IMPORTED, user_id: 'u2' }
    const supabase = semanticSupabase({ transactions: TXS, closedTrades: [IMPORTED, otherUser] })

    // Act
    await rebuildClosedTrades(supabase as never, 'u1', 'AAPL')

    // Assert
    expect(supabase.store.closed_trades.filter(r => r.user_id === 'u2')).toHaveLength(1)
  })
})

describe('rebuildONClosedTrades — same defect on the ON table', () => {
  const TXS = [
    { id: 'o1', date: '2026-04-01', operation: 'COMPRA', quantity: 100, price: 100, commission: 0, asset_type: 'ON' },
    { id: 'o2', date: '2026-04-09', operation: 'VENTA', quantity: 100, price: 105, commission: 0, asset_type: 'ON' },
  ]
  const IMPORTED = {
    user_id: 'u1', ticker: 'YM42D', open_date: '2026-04-01', close_date: '2026-04-09',
    avg_cost: 100, close_price: 105, quantity: 100, invested: 10000, proceeds: 10500,
    transaction_id: null,
  }

  it('removes the unlinked row instead of inserting a duplicate beside it', async () => {
    // Arrange
    const supabase = semanticSupabase({ transactions: TXS, onClosedTrades: [IMPORTED] })

    // Act
    await rebuildONClosedTrades(supabase as never, 'u1', 'YM42D')

    // Assert
    expect(supabase.store.on_closed_trades).toHaveLength(1)
    expect(supabase.store.on_closed_trades[0].transaction_id).toBe('o2')
  })

  it('is idempotent', async () => {
    // Arrange
    const supabase = semanticSupabase({ transactions: TXS, onClosedTrades: [IMPORTED] })

    // Act
    await rebuildONClosedTrades(supabase as never, 'u1', 'YM42D')
    await rebuildONClosedTrades(supabase as never, 'u1', 'YM42D')

    // Assert
    expect(supabase.store.on_closed_trades).toHaveLength(1)
  })
})
