/**
 * READ-ONLY — how far does the unlinked-closed_trades problem reach?
 *
 * closed_trades rows written by the bulk import carry transaction_id = NULL.
 * rebuildClosedTrades' cleanup uses `NOT (transaction_id IN (...))`, and in SQL
 * that is NULL — never TRUE — for a NULL transaction_id, so those rows survive
 * every rebuild while the upsert inserts a properly linked row beside them.
 *
 * Any rebuild of such a ticker therefore DOUBLES its realized P&L. This measures
 * the blast radius across both closed-trade tables, for every user.
 *
 * Classification per (user, ticker):
 *   DUPLICATED   linked rows AND unlinked rows -> the bug has already fired
 *   SOLE-UNLINKED  only unlinked rows -> import-era history; the ONLY record.
 *                  Deleting these would destroy real history. Do not touch.
 *   CLEAN        only linked rows
 *
 * Writes nothing.
 */
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const n = (v: any) => Number(v ?? 0)
const short = (id: any) => String(id ?? '').slice(0, 8)

async function fetchAll(table: string): Promise<any[]> {
  const PAGE = 1000
  const rows: any[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select('*').range(from, from + PAGE - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < PAGE) break
  }
  return rows
}

async function analyse(table: string) {
  const rows = await fetchAll(table)

  console.log(`\n${'='.repeat(100)}`)
  console.log(`${table.toUpperCase()} — ${rows.length} rows total`)
  console.log('='.repeat(100))

  if (rows.length === 0) { console.log('\n(empty)'); return }

  const unlinked = rows.filter(r => r.transaction_id == null)
  console.log(`\n  rows WITH    transaction_id : ${rows.length - unlinked.length}`)
  console.log(`  rows WITHOUT transaction_id : ${unlinked.length}   <-- invisible to the rebuild cleanup`)

  // group by user|ticker
  const groups = new Map<string, { linked: any[]; unlinked: any[] }>()
  for (const r of rows) {
    const key = `${r.user_id}|${r.ticker}`
    const g = groups.get(key) ?? { linked: [], unlinked: [] }
    ;(r.transaction_id == null ? g.unlinked : g.linked).push(r)
    groups.set(key, g)
  }

  const duplicated: string[] = []
  const soleUnlinked: string[] = []
  let clean = 0

  for (const [key, g] of groups) {
    if (g.unlinked.length > 0 && g.linked.length > 0) duplicated.push(key)
    else if (g.unlinked.length > 0) soleUnlinked.push(key)
    else clean++
  }

  const pnl = (rs: any[]) => rs.reduce((s, r) => s + n(r.proceeds) - n(r.invested), 0)

  console.log(`\n  (user, ticker) groups: ${groups.size}`)
  console.log(`     CLEAN          ${String(clean).padStart(4)}  (only linked rows)`)
  console.log(`     DUPLICATED     ${String(duplicated.length).padStart(4)}  (linked AND unlinked — bug already fired)`)
  console.log(`     SOLE-UNLINKED  ${String(soleUnlinked.length).padStart(4)}  (import-era only — the ONLY record, must NOT be deleted)`)

  if (duplicated.length > 0) {
    console.log('\n  --- DUPLICATED: realized P&L is currently inflated here ---')
    console.log('  USER      TICKER    LINKED  UNLINKED     LINKED P&L   UNLINKED P&L      INFLATION')
    let totalInflation = 0
    for (const key of duplicated.sort()) {
      const g = groups.get(key)!
      const [u, tk] = key.split('|')
      const lp = pnl(g.linked), up = pnl(g.unlinked)
      totalInflation += up
      console.log(
        `  ${short(u)}  ${String(tk).padEnd(8)} ${String(g.linked.length).padStart(6)} ${String(g.unlinked.length).padStart(9)} ` +
        `${lp.toFixed(2).padStart(15)} ${up.toFixed(2).padStart(14)} ${up.toFixed(2).padStart(14)}`
      )
    }
    console.log(`\n  TOTAL INFLATION FROM DUPLICATES: ${totalInflation.toFixed(4)}`)
  }

  if (soleUnlinked.length > 0) {
    console.log('\n  --- SOLE-UNLINKED: one rebuild away from duplicating ---')
    console.log('  USER      TICKER    ROWS          P&L   (a rebuild of this ticker doubles it)')
    const byUser = new Map<string, { rows: number; pnl: number; tickers: string[] }>()
    for (const key of soleUnlinked.sort()) {
      const g = groups.get(key)!
      const [u, tk] = key.split('|')
      const acc = byUser.get(u) ?? { rows: 0, pnl: 0, tickers: [] }
      acc.rows += g.unlinked.length
      acc.pnl += pnl(g.unlinked)
      acc.tickers.push(tk)
      byUser.set(u, acc)
      console.log(`  ${short(u)}  ${String(tk).padEnd(8)} ${String(g.unlinked.length).padStart(4)} ${pnl(g.unlinked).toFixed(2).padStart(12)}`)
    }
    console.log('\n  per user:')
    for (const [u, acc] of byUser) {
      console.log(`    ${short(u)}  ${acc.tickers.length} tickers, ${acc.rows} rows, P&L at risk ${acc.pnl.toFixed(2)}`)
    }
  }

  // Per-user realized totals as the UI would show them today
  console.log('\n  --- realized P&L per user, as the app reports it TODAY ---')
  const byUser = new Map<string, { all: any[]; linked: any[] }>()
  for (const r of rows) {
    const acc = byUser.get(r.user_id) ?? { all: [], linked: [] }
    acc.all.push(r)
    if (r.transaction_id != null) acc.linked.push(r)
    byUser.set(r.user_id, acc)
  }
  console.log('  USER          ROWS      REPORTED P&L    IF UNLINKED DROPPED')
  for (const [u, acc] of byUser) {
    console.log(`  ${short(u)}  ${String(acc.all.length).padStart(6)} ${pnl(acc.all).toFixed(2).padStart(17)} ${pnl(acc.linked).toFixed(2).padStart(22)}`)
  }
}

async function main() {
  await analyse('closed_trades')
  await analyse('on_closed_trades')
  console.log('\nDone. Read-only — nothing was modified.\n')
}

main().catch(err => { console.error('FAILED:', err); process.exit(1) })
