/**
 * A stateful fake Supabase client for the write path (odd/tasks/nucleo-ledger.md T5.1).
 * Serves and mutates the given tables (eq/is filters applied, paged by `range`), runs the
 * three ledger RPCs with migration 046's semantics, and THROWS on any access to the stored
 * derived tables, so a test using it proves the writer never touches them.
 */
import { STORED_TABLES } from './ledger-supabase'

type Row = Record<string, any>
export interface WriteFake {
  from(name: string): any
  rpc(name: string, params: Row): Promise<{ data: any; error: { message: string } | null }>
  tables: Record<string, Row[]>
  rpcCalls: Array<{ name: string; params: Row }>
}

let seq = 0
const stamp = () => new Date(Date.UTC(2026, 9, 22, 12, 0, 0, ++seq)).toISOString()

export function writeSupabase(initial: Record<string, Row[]> = {}): WriteFake {
  const tables: Record<string, Row[]> = {}
  for (const [k, v] of Object.entries(initial)) tables[k] = v.map(r => ({ ...r }))
  const of = (name: string) => (tables[name] ??= [])
  const insert = (name: string, row: Row) => {
    const full: Row = { id: `${name}-${of(name).length + 1}`, created_at: stamp(), ...row }
    of(name).push(full)
    return full
  }
  const rpcCalls: WriteFake['rpcCalls'] = []

  const fake: WriteFake = {
    tables,
    rpcCalls,
    from(name: string) {
      if (STORED_TABLES.includes(name)) throw new Error(`stored table access: ${name}`)
      const filters: Array<(r: Row) => boolean> = []
      let op: { kind: 'select' } | { kind: 'insert'; rows: Row[] } | { kind: 'update'; fields: Row } | { kind: 'delete' } = { kind: 'select' }
      let from = 0
      let to = Infinity
      const run = (): Row[] => {
        const match = of(name).filter(r => filters.every(f => f(r)))
        if (op.kind === 'insert') return op.rows.map(r => insert(name, r))
        if (op.kind === 'update') { const fields = op.fields; match.forEach(r => Object.assign(r, fields)); return match }
        if (op.kind === 'delete') { tables[name] = of(name).filter(r => !match.includes(r)); return match }
        return match.slice(from, to + 1)
      }
      const b: any = {
        select: () => b, order: () => b, gte: () => b, lte: () => b, in: () => b, or: () => b, gt: () => b, limit: () => b, not: () => b,
        eq: (c: string, v: unknown) => { filters.push(r => !(c in r) || r[c] === v); return b },
        is: (c: string, v: unknown) => { filters.push(r => (r[c] ?? null) === v); return b },
        range: (f: number, t: number) => { from = f; to = t; return b },
        insert: (rows: Row | Row[]) => { op = { kind: 'insert', rows: Array.isArray(rows) ? rows : [rows] }; return b },
        update: (fields: Row) => { op = { kind: 'update', fields }; return b },
        delete: () => { op = { kind: 'delete' }; return b },
        single: async () => { const [r] = run(); return r ? { data: r, error: null } : { data: null, error: { message: 'no rows' } } },
        maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
        then: (res: any, rej: any) => Promise.resolve({ data: run(), error: null }).then(res, rej),
      }
      return b
    },
    async rpc(name: string, p: Row) {
      rpcCalls.push({ name, params: p })
      if (name === 'process_transaction_atomic') return processAtomic(p)
      if (name === 'import_transactions_atomic' || name === 'replace_portfolio_atomic') return importAtomic(p, name === 'replace_portfolio_atomic')
      return { data: null, error: { message: `unknown rpc ${name}` } }
    },
  }

  /** Migration 046's process_transaction_atomic: ledger rows only. */
  function processAtomic(p: Row) {
    const opName = String(p.p_operation).toUpperCase()
    const ticker = p.p_ticker ? String(p.p_ticker).toUpperCase().trim() : null
    const commission = Number(p.p_commission ?? 0)
    const cashOnly = opName === 'DEPOSITO' || opName === 'RETIRO' || (opName === 'DIVIDENDO' && p.p_quantity == null)
    if (!['COMPRA', 'VENTA', 'DIVIDENDO', 'DEPOSITO', 'RETIRO'].includes(opName)) return { data: null, error: { message: `Invalid Operation: ${opName}` } }
    if (cashOnly) {
      if (!(Number(p.p_price) > 0)) return { data: null, error: { message: 'Invalid Amount' } }
      insert('cash_movements', { user_id: p.p_user_id, date: p.p_date, type: opName, amount: Number(p.p_price), description: p.p_notes ?? `${opName} ${ticker ?? ''}`, ticker, transaction_id: null })
      return { data: { success: true, transaction_id: null }, error: null }
    }
    const qty = Math.abs(Number(p.p_quantity))
    const price = Number(p.p_price)
    const tx = insert('transactions', {
      user_id: p.p_user_id, date: p.p_date, ticker, operation: opName, quantity: opName === 'VENTA' ? -qty : qty, price, commission,
      notes: p.p_notes ?? null, asset_type: String(p.p_asset_type ?? 'ACCION').toUpperCase(), moneda: p.p_moneda ?? 'USD',
    })
    const amount = opName === 'COMPRA' ? qty * price + commission : opName === 'VENTA' ? qty * price - commission : qty * price
    insert('cash_movements', { user_id: p.p_user_id, date: p.p_date, type: opName, amount: Math.abs(amount), description: p.p_notes ?? `${opName} ${ticker}`, ticker, transaction_id: tx.id })
    return { data: { success: true, transaction_id: tx.id }, error: null }
  }

  /** Migration 046's import/replace: transactions + linked cash_movements (trades typed RETIRO/DEPOSITO, as 036). */
  function importAtomic(p: Row, replace: boolean) {
    const user = p.p_user_id
    if (replace) {
      tables.cash_movements = of('cash_movements').filter(m => m.user_id !== user || m.transaction_id == null)
      tables.transactions = of('transactions').filter(t => t.user_id !== user)
    }
    const at = stamp()
    for (const t of p.p_transactions as Row[]) {
      const opName = String(t.operation).toUpperCase()
      if (!['COMPRA', 'VENTA', 'DIVIDENDO'].includes(opName)) return { data: [{ success: false, imported: 0, failed: 1, error_details: [{ line: 0, ticker: t.ticker, error: `Invalid operation type "${opName}"` }] }], error: null }
      const qty = Number(t.quantity)
      const price = Number(t.price)
      const commission = Number(t.commission ?? 0)
      const tx = insert('transactions', { user_id: user, date: t.date, ticker: String(t.ticker).toUpperCase(), operation: opName, quantity: opName === 'VENTA' ? -qty : qty, price, commission, asset_type: String(t.assetType ?? 'ACCION').toUpperCase(), created_at: at })
      const type = opName === 'COMPRA' ? 'RETIRO' : opName === 'VENTA' ? 'DEPOSITO' : 'DIVIDENDO'
      const amount = opName === 'COMPRA' ? qty * price + commission : opName === 'VENTA' ? qty * price - commission : qty * price
      insert('cash_movements', { user_id: user, date: t.date, type, amount, ticker: tx.ticker, transaction_id: tx.id, created_at: at })
    }
    return { data: [{ success: true, imported: (p.p_transactions as Row[]).length, failed: 0, error_details: [] }], error: null }
  }

  return fake
}
