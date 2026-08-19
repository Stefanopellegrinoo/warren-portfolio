/**
 * Repairs company names typed into the ticker field, and NVIDIA's pre-split basis.
 *
 *   DRY RUN (default):  npx tsx --env-file=.env scripts/repair-ticker-names.ts
 *   APPLY:              npx tsx --env-file=.env scripts/repair-ticker-names.ts --apply
 *
 * WHAT IT DOES
 *   1. NVIDIA was recorded at pre-split prices (10:1, June 2024). Yahoo's
 *      historical close is split-adjusted, so backfilling those dates would value
 *      the position at a tenth of its cost — a fabricated -90%. The four rows are
 *      reexpressed to the post-split basis: quantity x10, price /10. Cost is
 *      preserved exactly; this is what a broker does after a split.
 *   2. Eight company names become their real symbols, so historical prices can be
 *      fetched at all: DISNEY->DIS, EXXON->XOM, FORD->F, GOOGLE->GOOGL,
 *      NIKE->NKE, NVIDIA->NVDA, PAYPAL->PYPL, TESLA->TSLA. Each mapping was
 *      verified against Yahoo closes on the transaction dates (ratio ~1.000).
 *   3. Derived state is rebuilt through the app's OWN engine (rebuildPosition ->
 *      rebuildClosedTrades), never a second implementation of the cost math.
 *
 * SAFETY
 *   - Dry run is the default. Writing requires --apply.
 *   - Reexpression and rename happen in ONE guarded UPDATE per row, matching on
 *     the OLD ticker. Once applied the row no longer matches, so a re-run — or a
 *     crash mid-way followed by a re-run — cannot double-apply the x10.
 *   - The rewritten quantity/price are snapped to the DB grid (numeric(18,6) /
 *     numeric(18,4)) and the product is asserted unchanged BEFORE any write. A
 *     rounding that would move a cent aborts the run.
 *   - The full before-state is written to a JSON backup before the first write.
 *   - Invariants (cash balance, movement amounts, realized P&L, open positions)
 *     are captured before and re-checked after.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *   - Touch any cash amount. Renaming is a label change; reexpression preserves
 *     quantity*price exactly. cash_movements.amount is never written.
 *   - Correct transaction prices that disagree with Yahoo for reasons other than
 *     a split (AMD 2023-12-15, the 5d185007 batch, etc). Those affect cost basis,
 *     not the value series, and are a separate decision for a human.
 */
import { writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { rebuildPosition } from '../src/lib/portfolio-engine'

const APPLY = process.argv.includes('--apply')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/** Company name typed into the ticker field -> real symbol. Verified vs Yahoo. */
const RENAME: Record<string, string> = {
  DISNEY: 'DIS', EXXON: 'XOM', FORD: 'F', GOOGLE: 'GOOGL',
  NIKE: 'NKE', NVIDIA: 'NVDA', PAYPAL: 'PYPL', TESLA: 'TSLA',
}

/** Recorded pre-split; Yahoo closes are adjusted by this factor. */
const SPLIT_FACTOR: Record<string, number> = { NVIDIA: 10 }

const OLD_TICKERS = Object.keys(RENAME)
const TARGETS = Array.from(new Set(Object.values(RENAME)))
const ALL = Array.from(new Set([...OLD_TICKERS, ...TARGETS]))

/** transactions.quantity is numeric(18,6); price is numeric(18,4). */
const round6 = (v: number) => Math.round(v * 1e6) / 1e6
const round4 = (v: number) => Math.round(v * 1e4) / 1e4
const n = (v: any) => Number(v ?? 0)
const short = (id: string) => String(id).slice(0, 8)

function die(msg: string): never {
  console.error(`\nABORTED: ${msg}\n`)
  process.exit(1)
}

interface Invariants {
  balances: Record<string, number>
  txCount: number
  cashCount: number
  cashSum: number
  realized: number
  positions: Record<string, { quantity: number; avg_cost: number; total_invested: number }>
}

async function readInvariants(): Promise<Invariants> {
  const [balRes, txRes, cashRes, closedRes, posRes] = await Promise.all([
    supabase.from('cash_balance').select('user_id, balance'),
    supabase.from('transactions').select('id').in('ticker', ALL),
    supabase.from('cash_movements').select('amount').in('ticker', ALL),
    supabase.from('closed_trades').select('ticker, invested, proceeds').in('ticker', ALL),
    supabase.from('positions').select('user_id, ticker, quantity, avg_cost, total_invested').in('ticker', ALL),
  ])
  for (const r of [balRes, txRes, cashRes, closedRes, posRes]) {
    if (r.error) die(`reading invariants: ${r.error.message}`)
  }
  return {
    balances: Object.fromEntries((balRes.data ?? []).map((b: any) => [b.user_id, n(b.balance)])),
    txCount: (txRes.data ?? []).length,
    cashCount: (cashRes.data ?? []).length,
    cashSum: round4((cashRes.data ?? []).reduce((s: number, m: any) => s + n(m.amount), 0)),
    realized: round4((closedRes.data ?? []).reduce((s: number, c: any) => s + n(c.proceeds) - n(c.invested), 0)),
    positions: Object.fromEntries((posRes.data ?? []).map((p: any) => [
      `${p.user_id}|${p.ticker}`,
      { quantity: n(p.quantity), avg_cost: n(p.avg_cost), total_invested: n(p.total_invested) },
    ])),
  }
}

async function main() {
  console.log(`\n${'='.repeat(96)}`)
  console.log(APPLY ? '*** APPLY MODE — THIS WILL WRITE TO THE DATABASE ***' : 'DRY RUN — nothing will be written (pass --apply to write)')
  console.log('='.repeat(96))

  // ── Preflight: does anything else point at these strings? ────────────────
  console.log('\n--- PREFLIGHT: other tables referencing the old ticker strings ---')
  for (const table of ['signals', 'paper_trades', 'price_alerts']) {
    const { data, error } = await supabase.from(table).select('id, ticker').in('ticker', OLD_TICKERS)
    if (error) { console.log(`  ${table.padEnd(14)} could not check (${error.message})`); continue }
    const count = (data ?? []).length
    console.log(`  ${table.padEnd(14)} ${count} row(s)${count ? '  <<< these would keep the old string' : ''}`)
    if (count) (data ?? []).forEach((r: any) => console.log(`      ${r.ticker} (${String(r.id).slice(0, 8)})`))
  }

  const before = await readInvariants()

  // ── Build the plan ───────────────────────────────────────────────────────
  const { data: txs, error: txErr } = await supabase
    .from('transactions').select('*').in('ticker', OLD_TICKERS).order('date')
  if (txErr) die(`reading transactions: ${txErr.message}`)

  const { data: cashRows, error: cashErr } = await supabase
    .from('cash_movements').select('*').in('ticker', OLD_TICKERS).order('date')
  if (cashErr) die(`reading cash_movements: ${cashErr.message}`)

  if ((txs ?? []).length === 0) {
    console.log('\nNothing to do — no transaction carries an old ticker string.\n')
    return
  }

  interface Plan { id: string; user_id: string; from: string; to: string; oldQ: number; oldP: number; newQ: number; newP: number; date: string; op: string }
  const plan: Plan[] = []

  for (const t of txs!) {
    const from = String(t.ticker)
    const to = RENAME[from]
    if (!to) die(`unexpected ticker ${from}`)
    const factor = SPLIT_FACTOR[from] ?? 1
    const oldQ = n(t.quantity), oldP = n(t.price)
    const newQ = round6(oldQ * factor)
    const newP = round4(oldP / factor)

    // The one thing that may never change: the money moved by this row.
    const oldTotal = oldQ * oldP
    const newTotal = newQ * newP
    if (Math.abs(oldTotal - newTotal) > 0.00005) {
      die(`reexpressing ${from} ${t.date} would move money: ${oldTotal.toFixed(6)} -> ${newTotal.toFixed(6)}`)
    }
    plan.push({ id: t.id, user_id: t.user_id, from, to, oldQ, oldP, newQ, newP, date: t.date, op: t.operation })
  }

  console.log(`\n--- PLAN: ${plan.length} transaction rows ---`)
  console.log('USER      DATE        OP        FROM   -> TO       QUANTITY                 PRICE')
  for (const p of plan) {
    const qChanged = p.newQ !== p.oldQ
    const pChanged = p.newP !== p.oldP
    console.log(
      `${short(p.user_id)}  ${p.date}  ${p.op.padEnd(8)} ${p.from.padEnd(6)} -> ${p.to.padEnd(6)} ` +
      `${qChanged ? `${p.oldQ.toFixed(6)} -> ${p.newQ.toFixed(6)}` : `${p.oldQ.toFixed(6)} (unchanged)`.padEnd(24)}  ` +
      `${pChanged ? `${p.oldP.toFixed(4)} -> ${p.newP.toFixed(4)}` : `${p.oldP.toFixed(4)} (unchanged)`}`
    )
  }

  console.log(`\n--- PLAN: ${(cashRows ?? []).length} cash_movements label renames (amounts untouched) ---`)
  const cashByTicker = new Map<string, number>()
  for (const m of cashRows ?? []) cashByTicker.set(String(m.ticker), (cashByTicker.get(String(m.ticker)) ?? 0) + 1)
  for (const [tk, c] of cashByTicker) console.log(`  ${tk.padEnd(8)} -> ${RENAME[tk].padEnd(6)}  ${c} row(s)`)

  const rebuildTargets = Array.from(new Set(plan.map(p => `${p.user_id}|${p.to}`)))
  console.log(`\n--- PLAN: rebuild positions + closed_trades for ${rebuildTargets.length} (user, ticker) pairs ---`)
  rebuildTargets.forEach(k => console.log(`  ${short(k.split('|')[0])}  ${k.split('|')[1]}`))

  console.log('\n--- INVARIANTS BEFORE ---')
  console.log(`  transactions on affected tickers : ${before.txCount}`)
  console.log(`  cash movements                   : ${before.cashCount}  sum ${before.cashSum.toFixed(4)}`)
  console.log(`  realized P&L                     : ${before.realized.toFixed(4)}`)
  Object.entries(before.balances).forEach(([u, b]) => console.log(`  cash balance ${short(u)}          : ${b.toFixed(4)}`))

  if (!APPLY) {
    console.log(`\n${'='.repeat(96)}`)
    console.log('DRY RUN COMPLETE — nothing was written. Re-run with --apply to execute this plan.')
    console.log('='.repeat(96) + '\n')
    return
  }

  // ── Backup before the first write ────────────────────────────────────────
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = `./ticker-repair-backup-${stamp}.json`
  writeFileSync(backupPath, JSON.stringify({
    takenAt: new Date().toISOString(),
    transactions: txs, cashMovements: cashRows, invariantsBefore: before, plan,
  }, null, 2))
  console.log(`\nBackup written: ${backupPath}`)

  // ── Writes. Each guarded on the OLD ticker, so a re-run is a no-op. ───────
  console.log('\n--- APPLYING ---')
  let txDone = 0
  for (const p of plan) {
    const { error, count } = await supabase
      .from('transactions')
      .update({ ticker: p.to, quantity: p.newQ, price: p.newP }, { count: 'exact' })
      .eq('id', p.id)
      .eq('ticker', p.from)     // guard: after this runs the row no longer matches
    if (error) die(`updating transaction ${p.id}: ${error.message}`)
    if (count === 0) console.warn(`  warn: ${p.id} did not match ${p.from} (already applied?)`)
    else txDone++
  }
  console.log(`  transactions updated : ${txDone}`)

  let cashDone = 0
  for (const m of cashRows ?? []) {
    const to = RENAME[String(m.ticker)]
    const { error, count } = await supabase
      .from('cash_movements')
      .update({ ticker: to }, { count: 'exact' })
      .eq('id', m.id)
      .eq('ticker', m.ticker)
    if (error) die(`updating cash_movement ${m.id}: ${error.message}`)
    if (count && count > 0) cashDone++
  }
  console.log(`  cash labels updated  : ${cashDone}`)

  for (const key of rebuildTargets) {
    const [userId, ticker] = key.split('|')
    await rebuildPosition(supabase as any, userId, ticker)
    console.log(`  rebuilt ${short(userId)} ${ticker}`)
  }

  // ── Verify ───────────────────────────────────────────────────────────────
  const after = await readInvariants()
  console.log(`\n${'='.repeat(96)}`)
  console.log('VERIFICATION')
  console.log('='.repeat(96))

  const failures: string[] = []
  const check = (label: string, a: number, b: number, tol = 0.0001) => {
    const ok = Math.abs(a - b) <= tol
    console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label.padEnd(34)} before ${a.toFixed(4).padStart(14)}   after ${b.toFixed(4).padStart(14)}`)
    if (!ok) failures.push(label)
  }

  check('transaction count', before.txCount, after.txCount)
  check('cash movement count', before.cashCount, after.cashCount)
  check('cash movement sum', before.cashSum, after.cashSum)
  check('realized P&L', before.realized, after.realized, 0.01)
  for (const [user, bal] of Object.entries(before.balances)) {
    check(`cash balance ${short(user)}`, bal, after.balances[user] ?? NaN)
  }

  console.log('\n  open positions on affected tickers:')
  const posKeys = new Set([...Object.keys(before.positions), ...Object.keys(after.positions)])
  for (const k of posKeys) {
    const b = before.positions[k], a = after.positions[k]
    const [u, tk] = k.split('|')
    if (!b) { console.log(`    NEW   ${short(u)} ${tk}  qty ${a.quantity} avg ${a.avg_cost}`); continue }
    if (!a) { console.log(`    GONE  ${short(u)} ${tk}  (was qty ${b.quantity})`); failures.push(`position vanished: ${k}`); continue }
    const same = Math.abs(b.quantity - a.quantity) < 1e-6 && Math.abs(b.total_invested - a.total_invested) < 0.01
    console.log(`    ${same ? 'OK  ' : 'DIFF'}  ${short(u)} ${tk.padEnd(6)} qty ${b.quantity} -> ${a.quantity}   invested ${b.total_invested.toFixed(2)} -> ${a.total_invested.toFixed(2)}`)
    if (!same) failures.push(`position changed: ${k}`)
  }

  console.log()
  if (failures.length) {
    console.error(`FAILED — ${failures.length} invariant(s) broken:`)
    failures.forEach(f => console.error(`   - ${f}`))
    console.error(`\nThe backup is at ${backupPath}. Do NOT run anything else until this is resolved.\n`)
    process.exit(1)
  }
  console.log('All invariants hold. Repair complete.')
  console.log(`Backup kept at ${backupPath} — move it somewhere safe.\n`)
  console.log('NEXT: the dashboard may serve cached numbers for up to 10 minutes.')
  console.log('      Restart the app container or wait for the TTL to expire.\n')
}

main().catch(err => { console.error('FAILED:', err); process.exit(1) })
