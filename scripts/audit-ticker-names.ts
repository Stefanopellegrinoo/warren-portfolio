/**
 * READ-ONLY diagnostic — ticker string quality across the real transaction history.
 *
 * Answers, before the portfolio_snapshots backfill touches anything:
 *  1. Every distinct ticker in `transactions`, with asset_type, op counts and date range.
 *  2. Which of those are missing from the `ticker_identity` catalog.
 *  3. Whether a company-name ticker (TESLA) coexists with its real symbol (TSLA)
 *     for the SAME user, and whether their holding periods overlap.
 *  4. Whether any of them is still open in `positions` / `on_positions`.
 *  5. The recorded prices, to tell an underlying-share price from a CEDEAR-unit price.
 *
 * Performs SELECTs only. No insert, update, delete or RPC.
 */
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase env vars. Run with: npx tsx --env-file=.env.local scripts/audit-ticker-names.ts')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

/** PostgREST caps a response at 1000 rows; walk the whole table. */
async function fetchAll(table: string, columns: string): Promise<any[]> {
  const PAGE = 1000
  const rows: any[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < PAGE) break
  }
  return rows
}

const short = (id: string) => String(id).slice(0, 8)
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

async function main() {
  const [transactions, catalog, positions, onPositions] = await Promise.all([
    fetchAll('transactions', 'user_id, date, ticker, operation, quantity, price, commission, asset_type, moneda, created_at'),
    fetchAll('ticker_identity', 'ticker, yahoo_symbol, confirmed_name'),
    fetchAll('positions', 'user_id, ticker, quantity, avg_cost, total_invested'),
    fetchAll('on_positions', 'user_id, ticker, quantity, avg_cost, total_invested'),
  ])

  const catalogued = new Set(catalog.map(c => c.ticker))

  console.log(`\n${'='.repeat(78)}`)
  console.log(`TRANSACTIONS: ${transactions.length} rows | CATALOG: ${catalog.length} tickers`)
  console.log(`POSITIONS: ${positions.length} stock, ${onPositions.length} ON`)
  console.log('='.repeat(78))

  // ── 1 + 2. Ticker universe, per user ─────────────────────────────────────
  type Agg = {
    ticker: string
    user: string
    assetTypes: Set<string>
    monedas: Set<string>
    buys: number
    sells: number
    others: number
    first: string
    last: string
    minPrice: number
    maxPrice: number
    netQty: number
  }
  const agg = new Map<string, Agg>()

  for (const t of transactions) {
    const key = `${t.user_id}|${t.ticker}`
    let a = agg.get(key)
    if (!a) {
      a = {
        ticker: t.ticker, user: t.user_id,
        assetTypes: new Set(), monedas: new Set(),
        buys: 0, sells: 0, others: 0,
        first: t.date, last: t.date,
        minPrice: Infinity, maxPrice: -Infinity, netQty: 0,
      }
      agg.set(key, a)
    }
    a.assetTypes.add(t.asset_type ?? '(null)')
    a.monedas.add(t.moneda ?? '(null)')
    if (t.operation === 'COMPRA') { a.buys++; a.netQty += Math.abs(Number(t.quantity)) }
    else if (t.operation === 'VENTA') { a.sells++; a.netQty -= Math.abs(Number(t.quantity)) }
    else a.others++
    if (t.date < a.first) a.first = t.date
    if (t.date > a.last) a.last = t.date
    const p = Number(t.price)
    if (p < a.minPrice) a.minPrice = p
    if (p > a.maxPrice) a.maxPrice = p
  }

  const byUser = new Map<string, Agg[]>()
  for (const a of agg.values()) {
    const list = byUser.get(a.user) ?? []
    list.push(a)
    byUser.set(a.user, list)
  }

  for (const [user, list] of byUser) {
    console.log(`\n\n### USER ${short(user)} — ${list.length} distinct tickers`)
    console.log(
      'CAT  TICKER      TYPE     CCY   BUY SELL OTH  FIRST       LAST        NET QTY        PRICE RANGE'
    )
    console.log('-'.repeat(110))
    for (const a of list.sort((x, y) => x.ticker.localeCompare(y.ticker))) {
      const flag = catalogued.has(a.ticker) ? ' ok ' : ' ** '
      console.log(
        `${flag} ${a.ticker.padEnd(11)} ${[...a.assetTypes].join('/').padEnd(8)} ` +
        `${[...a.monedas].join('/').padEnd(5)} ${String(a.buys).padStart(3)} ${String(a.sells).padStart(4)} ` +
        `${String(a.others).padStart(3)}  ${a.first}  ${a.last}  ${a.netQty.toFixed(4).padStart(12)}  ` +
        `${money(a.minPrice)} – ${money(a.maxPrice)}`
      )
    }
  }

  // ── 3. Name-ticker vs real-symbol coexistence ────────────────────────────
  console.log(`\n\n${'='.repeat(78)}`)
  console.log('COEXISTENCE: company-name ticker vs its real symbol, same user')
  console.log('='.repeat(78))

  const SUSPECTS: Record<string, string[]> = {
    DISNEY: ['DIS'], EXXON: ['XOM'], FORD: ['F'], GOOGLE: ['GOOGL', 'GOOG'],
    NIKE: ['NKE'], NVIDIA: ['NVDA'], PAYPAL: ['PYPL'], TESLA: ['TSLA'],
  }

  let foundAny = false
  for (const [user, list] of byUser) {
    const held = new Map(list.map(a => [a.ticker, a]))
    for (const [name, symbols] of Object.entries(SUSPECTS)) {
      const bad = held.get(name)
      if (!bad) continue
      foundAny = true
      console.log(`\nUSER ${short(user)} — "${name}"`)
      console.log(`   ${name.padEnd(7)} ${bad.first} → ${bad.last}  net ${bad.netQty.toFixed(4)}  ` +
                  `${bad.buys}B/${bad.sells}S  price ${money(bad.minPrice)}–${money(bad.maxPrice)}`)
      for (const sym of symbols) {
        const good = held.get(sym)
        if (!good) { console.log(`   ${sym.padEnd(7)} (not held by this user)`); continue }
        const overlap = bad.first <= good.last && good.first <= bad.last
        console.log(`   ${sym.padEnd(7)} ${good.first} → ${good.last}  net ${good.netQty.toFixed(4)}  ` +
                    `${good.buys}B/${good.sells}S  price ${money(good.minPrice)}–${money(good.maxPrice)}`)
        console.log(`   >>> PERIODS ${overlap ? 'OVERLAP — merging would change avg cost' : 'do NOT overlap'}`)
      }
    }
  }
  if (!foundAny) console.log('\n(no company-name ticker found in transactions)')

  // ── 4. Still open? ───────────────────────────────────────────────────────
  console.log(`\n\n${'='.repeat(78)}`)
  console.log('OPEN POSITIONS carrying an uncatalogued ticker')
  console.log('='.repeat(78))
  const openBad = [
    ...positions.map(p => ({ ...p, table: 'positions' })),
    ...onPositions.map(p => ({ ...p, table: 'on_positions' })),
  ].filter(p => !catalogued.has(p.ticker))

  if (openBad.length === 0) {
    console.log('\n(none — every open position is catalogued)')
  } else {
    for (const p of openBad) {
      console.log(`  ${p.table.padEnd(13)} ${short(p.user_id)}  ${String(p.ticker).padEnd(10)} ` +
                  `qty ${Number(p.quantity).toFixed(4).padStart(12)}  avg ${money(Number(p.avg_cost))}  ` +
                  `invested ${money(Number(p.total_invested))}`)
    }
  }

  // ── 5. Positions with NO transactions behind them (the backfill gate) ────
  console.log(`\n\n${'='.repeat(78)}`)
  console.log('POSITIONS WITH NO TRANSACTIONS BEHIND THEM (backfill gate would skip these users)')
  console.log('='.repeat(78))
  const txKeys = new Set(transactions.map(t => `${t.user_id}|${t.ticker}`))
  const orphans = [...positions, ...onPositions].filter(p => !txKeys.has(`${p.user_id}|${p.ticker}`))
  if (orphans.length === 0) {
    console.log('\n(none)')
  } else {
    for (const p of orphans) {
      console.log(`  ${short(p.user_id)}  ${String(p.ticker).padEnd(10)} qty ${Number(p.quantity).toFixed(4).padStart(12)}  ` +
                  `avg ${money(Number(p.avg_cost))}  invested ${money(Number(p.total_invested))}`)
    }
  }

  console.log('\nDone. Read-only — nothing was modified.\n')
}

main().catch(err => {
  console.error('FAILED:', err)
  process.exit(1)
})
