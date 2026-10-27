/** A counting fake Supabase client: every awaited query (one HTTP request) counts once per table. */
export type Row = Record<string, unknown>
export const reads: Record<string, number> = {}
export const resetReads = () => { for (const k of Object.keys(reads)) delete reads[k] }
export const failing = new Set<string>()

export function fakeDb(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const filters: ((r: Row) => boolean)[] = []
      let from = 0, to = Infinity
      let patch: Row | null = null
      const run = () => {
        const key = patch ? `${table}:update` : table
        reads[key] = (reads[key] ?? 0) + 1
        if (failing.has(table)) return { data: null, error: { message: `${table} down`, code: 'XX000' } }
        const rows = (tables[table] ?? []).filter(r => filters.every(f => f(r)))
        if (patch) { for (const r of rows) Object.assign(r, patch); return { data: rows.map(r => ({ id: r.id })), error: null } }
        return { data: rows.slice(from, to === Infinity ? undefined : to + 1).map(r => ({ ...r })), error: null }
      }
      const q: any = {}
      for (const m of ['select', 'order', 'limit', 'or', 'gte', 'lte', 'neq', 'is', 'not']) q[m] = () => q
      q.eq = (c: string, v: unknown) => { filters.push(r => r[c] === v); return q }
      q.in = (c: string, vs: unknown[]) => { filters.push(r => vs.includes(r[c])); return q }
      q.range = (a: number, b: number) => { from = a; to = b; return q }
      q.update = (p: Row) => { patch = p; return q }
      q.single = () => q
      q.maybeSingle = () => q
      q.then = (ok: any, ko: any) => Promise.resolve().then(run).then(ok, ko)
      return q
    },
  }
}

export const U1_TABLES: Record<string, Row[]> = {
  transactions: [
    { id: 1, user_id: 'u1', ticker: 'KO', operation: 'COMPRA', quantity: 10, price: 60, commission: 1, date: '2026-03-02', asset_type: 'STOCK',
      created_at: '2026-03-02T13:00:00Z', trade_currency: 'CCL', trade_quantity: 10, trade_price: 60, trade_commission: 1, fx_mep: 1180, fx_ccl: 1200 },
    { id: 2, user_id: 'u1', ticker: 'AAPL', operation: 'COMPRA', quantity: 0.5, price: 320, commission: 0, date: '2026-05-04', asset_type: 'CEDEAR',
      created_at: '2026-05-04T12:00:00Z', trade_currency: 'ARS', trade_quantity: 10, trade_price: 22_400, trade_commission: 0, fx_mep: null, fx_ccl: null },
    { id: 3, user_id: 'u1', ticker: 'YMCID', operation: 'COMPRA', quantity: 50, price: 98, commission: 0.5, date: '2026-04-10', asset_type: 'ON',
      created_at: '2026-04-10T15:00:00Z', trade_currency: 'MEP', trade_quantity: 5000, trade_price: 98, trade_commission: 0.5, fx_mep: 1300, fx_ccl: 1320 },
    { id: 4, user_id: 'u1', ticker: 'KO', operation: 'VENTA', quantity: 2, price: 65, commission: 0.5, date: '2026-07-01', asset_type: 'STOCK',
      created_at: '2026-07-01T14:00:00Z', trade_currency: 'CCL', trade_quantity: 2, trade_price: 65, trade_commission: 0.5, fx_mep: 1250, fx_ccl: 1270 },
  ],
  cash_movements: [
    { id: 1, user_id: 'u1', type: 'DEPOSITO', amount: 10_000, date: '2026-03-01' },
    { id: 2, user_id: 'u1', type: 'RETIRO', amount: 500, date: '2026-08-01' },
  ],
  on_payment_overrides: [{ id: 1, user_id: 'u1', ticker: 'YMCID', pay_date: '2026-07-15', kind: 'coupon', amount: 1.9 }],
  on_terms: [{ isin: 'ARYMCI000001', ticker_o: 'YMCIO', ticker_d: 'YMCID', ticker_c: 'YMCIC' }],
  on_flow_history: [{ isin: 'ARYMCI000001', flow_date: '2026-07-15', ren: 2, amo: 0, first_seen_as_of: '2026-04-01', last_seen_as_of: '2026-07-20', source: 'byma' }],
  on_cashflows: [
    { isin: 'ARYMCI000001', flow_date: '2026-07-15', ren: 2, amo: 0 },
    { isin: 'ARYMCI000001', flow_date: '2026-10-15', ren: 2, amo: 25 },
    { isin: 'ARYMCI000001', flow_date: '2027-01-15', ren: 1.5, amo: 25 },
  ],
  cedears: [{ ticker: 'AAPL', ratio: 20 }],
  fx_rates: [
    { date: '2026-05-04', kind: 'ccl', buy: 1390, sell: 1410 }, { date: '2026-05-04', kind: 'mep', buy: 1380, sell: 1400 },
    { date: '2026-05-01', kind: 'ccl', buy: 1385, sell: 1405 }, { date: '2026-05-01', kind: 'mep', buy: 1375, sell: 1395 },
  ],
  stock_splits: [{ ticker: 'KO', date: '2026-06-01', numerator: 2, denominator: 1 }],
  ons: [{ ticker: 'YMCID' }],
  price_alerts: [],
}

/** A second user holding another ON, so the shared schedules carry a ticker u1 never traded. */
export const TWO_USER_TABLES: Record<string, Row[]> = {
  ...U1_TABLES,
  transactions: [...U1_TABLES.transactions,
    { id: 5, user_id: 'u2', ticker: 'ZZZZD', operation: 'COMPRA', quantity: 30, price: 100, commission: 0, date: '2026-02-10', asset_type: 'ON',
      created_at: '2026-02-10T15:00:00Z', trade_currency: 'MEP', trade_quantity: 3000, trade_price: 100, trade_commission: 0, fx_mep: 1100, fx_ccl: 1120 },
    { id: 6, user_id: 'u2', ticker: 'AAPL', operation: 'COMPRA', quantity: 1, price: 300, commission: 0, date: '2026-05-01', asset_type: 'CEDEAR',
      created_at: '2026-05-01T12:00:00Z', trade_currency: 'ARS', trade_quantity: 20, trade_price: 21_000, trade_commission: 0, fx_mep: null, fx_ccl: null },
  ],
  cash_movements: [...U1_TABLES.cash_movements, { id: 3, user_id: 'u2', type: 'DEPOSITO', amount: 4000, date: '2026-02-01' }],
  on_payment_overrides: [...U1_TABLES.on_payment_overrides, { id: 2, user_id: 'u2', ticker: 'ZZZZD', pay_date: '2026-08-10', kind: 'amortization', amount: null }],
  on_terms: [...U1_TABLES.on_terms, { isin: 'ARZZZZ000001', ticker_o: 'ZZZZO', ticker_d: 'ZZZZD', ticker_c: 'ZZZZC' }],
  on_cashflows: [...U1_TABLES.on_cashflows,
    { isin: 'ARZZZZ000001', flow_date: '2026-08-10', ren: 3, amo: 50 }, { isin: 'ARZZZZ000001', flow_date: '2027-02-10', ren: 3, amo: 50 }],
  ons: [{ ticker: 'YMCID' }, { ticker: 'ZZZZD' }],
}

export const quote = (ticker: string, price: number) => ({ ticker, price, change: 1, changePercent: 0.5, previousClose: price - 1 })
