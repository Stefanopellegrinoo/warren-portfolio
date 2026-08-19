/**
 * READ-ONLY — the exact "before" state of everything the ticker repair touches.
 *
 * Captures, per affected ticker: transactions, cash_movements, closed_trades and
 * positions. Two purposes:
 *   1. Design the repair against real rows instead of assumptions.
 *   2. Serve as the baseline the post-repair verification compares against —
 *      the invariants that MUST hold are printed at the end.
 *
 * SELECT only. Writes nothing.
 */
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/** Company name typed into the ticker field -> the real symbol. */
const RENAME: Record<string, string> = {
  DISNEY: 'DIS', EXXON: 'XOM', FORD: 'F', GOOGLE: 'GOOGL',
  NIKE: 'NKE', NVIDIA: 'NVDA', PAYPAL: 'PYPL', TESLA: 'TSLA',
}

/** NVIDIA was recorded pre-split; Yahoo prices are adjusted 10:1 (June 2024). */
const SPLIT_FACTOR: Record<string, number> = { NVIDIA: 10 }

const AFFECTED = Array.from(new Set([...Object.keys(RENAME), ...Object.values(RENAME)]))

const n = (v: any) => Number(v ?? 0)
const f2 = (v: number) => v.toFixed(2).padStart(12)
const f4 = (v: number) => v.toFixed(4).padStart(14)
const short = (id: string) => String(id).slice(0, 8)

async function main() {
  const [txRes, cashRes, closedRes, posRes] = await Promise.all([
    supabase.from('transactions').select('*').in('ticker', AFFECTED).order('date'),
    supabase.from('cash_movements').select('*').in('ticker', AFFECTED).order('date'),
    supabase.from('closed_trades').select('*').in('ticker', AFFECTED).order('close_date'),
    supabase.from('positions').select('*').in('ticker', AFFECTED),
  ])

  for (const [label, res] of [['transactions', txRes], ['cash_movements', cashRes], ['closed_trades', closedRes], ['positions', posRes]] as const) {
    if (res.error) throw new Error(`${label}: ${res.error.message}`)
  }

  const txs = txRes.data ?? []
  const cash = cashRes.data ?? []
  const closed = closedRes.data ?? []
  const positions = posRes.data ?? []

  // ── Transactions, grouped by the symbol they will end up under ───────────
  console.log(`\n${'='.repeat(104)}`)
  console.log('TRANSACTIONS on affected tickers (grouped by TARGET symbol)')
  console.log('='.repeat(104))

  const byTarget = new Map<string, any[]>()
  for (const t of txs) {
    const target = RENAME[t.ticker] ?? t.ticker
    const list = byTarget.get(target) ?? []
    list.push(t)
    byTarget.set(target, list)
  }

  for (const target of Array.from(byTarget.keys()).sort()) {
    const rows = byTarget.get(target)!.sort((a, b) =>
      a.date === b.date ? String(a.created_at).localeCompare(String(b.created_at)) : String(a.date).localeCompare(String(b.date))
    )
    console.log(`\n--- ${target} (${rows.length} transactions) ---`)
    console.log('USER      FROM     DATE        OP           QUANTITY        PRICE   COMMISSION        TOTAL  TYPE    AVG_AFTER  ID')
    for (const t of rows) {
      const total = n(t.quantity) * n(t.price) + n(t.commission)
      console.log(
        `${short(t.user_id)}  ${String(t.ticker).padEnd(7)} ${t.date}  ${String(t.operation).padEnd(8)}` +
        `${f4(n(t.quantity))} ${f2(n(t.price))} ${f2(n(t.commission))} ${f2(total)}  ` +
        `${String(t.asset_type ?? '-').padEnd(7)} ${String(n(t.avg_cost_after).toFixed(4)).padStart(10)}  ${String(t.id).slice(0, 8)}`
      )
    }
  }

  // ── The exact NVIDIA rewrite, computed and checked ───────────────────────
  console.log(`\n\n${'='.repeat(104)}`)
  console.log('NVIDIA REEXPRESSION — proposed new values, and the invariant that must hold')
  console.log('='.repeat(104))

  for (const [ticker, factor] of Object.entries(SPLIT_FACTOR)) {
    const rows = txs.filter(t => t.ticker === ticker)
    if (rows.length === 0) { console.log(`\n(no ${ticker} rows)`); continue }
    console.log(`\n${ticker} — factor ${factor}:1  (quantity x${factor}, price /${factor})\n`)
    console.log('DATE        OP          OLD QUANTITY     OLD PRICE       NEW QUANTITY     NEW PRICE      OLD TOTAL     NEW TOTAL   EXACT?')
    let oldSum = 0, newSum = 0
    for (const t of rows.sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
      const oldQ = n(t.quantity), oldP = n(t.price)
      const newQ = oldQ * factor, newP = oldP / factor
      const oldTotal = oldQ * oldP, newTotal = newQ * newP
      // price is numeric(18,4), quantity numeric(18,6) — check the rewrite survives the grid
      const pFits = Math.abs(newP - Math.round(newP * 1e4) / 1e4) < 1e-12
      const qFits = Math.abs(newQ - Math.round(newQ * 1e6) / 1e6) < 1e-12
      const exact = Math.abs(oldTotal - newTotal) < 1e-9 && pFits && qFits
      oldSum += oldTotal; newSum += newTotal
      console.log(
        `${t.date}  ${String(t.operation).padEnd(8)}${f4(oldQ)} ${f2(oldP)}   ${f4(newQ)} ${f2(newP)} ${f2(oldTotal)} ${f2(newTotal)}   ${exact ? 'yes' : 'NO <<<'}`
      )
    }
    console.log(`\n  gross traded value  old ${oldSum.toFixed(6)}   new ${newSum.toFixed(6)}   delta ${(newSum - oldSum).toExponential(2)}`)
    console.log('  (must be zero — the reexpression may not move a single cent of cash)')
  }

  // ── Cash movements: these carry a ticker label but no money changes ───────
  console.log(`\n\n${'='.repeat(104)}`)
  console.log('CASH MOVEMENTS carrying an affected ticker (label only — amounts must NOT change)')
  console.log('='.repeat(104))
  if (cash.length === 0) console.log('\n(none)')
  else {
    console.log('\nUSER      TICKER   DATE        TYPE           AMOUNT  LINKED TX  DESCRIPTION')
    for (const m of cash) {
      console.log(
        `${short(m.user_id)}  ${String(m.ticker).padEnd(8)} ${m.date}  ${String(m.type).padEnd(10)} ${f2(n(m.amount))}  ` +
        `${m.transaction_id ? String(m.transaction_id).slice(0, 8) : '   NULL '}   ${String(m.description ?? '').slice(0, 40)}`
      )
    }
    const cashTotal = cash.reduce((s, m) => s + n(m.amount), 0)
    console.log(`\n  rows ${cash.length}   sum of amounts ${cashTotal.toFixed(4)}  <-- must be identical after the repair`)
  }

  // ── Closed trades and open positions ─────────────────────────────────────
  console.log(`\n\n${'='.repeat(104)}`)
  console.log('CLOSED TRADES on affected tickers (will be rebuilt)')
  console.log('='.repeat(104))
  if (closed.length === 0) console.log('\n(none)')
  else {
    console.log('\nUSER      TICKER   OPEN        CLOSE          QUANTITY     AVG_COST   CLOSE_PRICE     INVESTED     PROCEEDS          PNL')
    let realized = 0
    for (const c of closed.sort((a, b) => String(a.ticker).localeCompare(String(b.ticker)))) {
      const pnl = n(c.proceeds) - n(c.invested)
      realized += pnl
      console.log(
        `${short(c.user_id)}  ${String(c.ticker).padEnd(8)} ${c.open_date}  ${c.close_date} ${f4(n(c.quantity))} ` +
        `${f2(n(c.avg_cost))} ${f2(n(c.close_price))} ${f2(n(c.invested))} ${f2(n(c.proceeds))} ${f2(pnl)}`
      )
    }
    console.log(`\n  trades ${closed.length}   TOTAL REALIZED P&L ${realized.toFixed(4)}  <-- must be identical after the repair`)
  }

  console.log(`\n\n${'='.repeat(104)}`)
  console.log('OPEN POSITIONS on affected tickers (will be rebuilt)')
  console.log('='.repeat(104))
  if (positions.length === 0) console.log('\n(none)')
  else {
    console.log('\nUSER      TICKER         QUANTITY     AVG_COST     INVESTED  FIRST_BOUGHT')
    for (const p of positions) {
      console.log(`${short(p.user_id)}  ${String(p.ticker).padEnd(8)} ${f4(n(p.quantity))} ${f2(n(p.avg_cost))} ${f2(n(p.total_invested))}  ${p.first_bought}`)
    }
  }

  // ── The invariants the repair must preserve ──────────────────────────────
  const { data: balances } = await supabase.from('cash_balance').select('user_id, balance')
  console.log(`\n\n${'='.repeat(104)}`)
  console.log('INVARIANTS — record these; the post-repair check compares against them')
  console.log('='.repeat(104))
  console.log('\nCASH BALANCE per user (must be byte-identical after the repair):')
  for (const b of balances ?? []) console.log(`  ${short(b.user_id)}  ${n(b.balance).toFixed(4)}`)
  console.log(`\nTransactions on affected tickers : ${txs.length}  (count must not change)`)
  console.log(`Cash movements on those tickers  : ${cash.length}  (count and amounts must not change)`)
  console.log(`Realized P&L on those tickers    : ${closed.reduce((s, c) => s + n(c.proceeds) - n(c.invested), 0).toFixed(4)}`)

  console.log('\nDone. Read-only — nothing was modified.\n')
}

main().catch(err => { console.error('FAILED:', err); process.exit(1) })
