/**
 * Removes the closed_trades rows that the ticker repair superseded.
 *
 *   DRY RUN (default):  npx tsx --env-file=.env scripts/cleanup-stale-closed-trades.ts
 *   APPLY:              npx tsx --env-file=.env scripts/cleanup-stale-closed-trades.ts --apply
 *
 * WHY THESE ROWS EXIST
 *   Every closed_trades row written by the bulk import carries transaction_id =
 *   NULL. rebuildClosedTrades' cleanup filters with `NOT (transaction_id IN
 *   (...))`, which is NULL — never TRUE — for a NULL transaction_id, so those
 *   rows survive the rebuild while the upsert (ON CONFLICT transaction_id, and
 *   UNIQUE lets many NULLs coexist) inserts a properly linked row beside them.
 *   Rebuilding the 8 renamed tickers therefore left 19 superseded rows behind.
 *
 * SCOPE — deliberately narrow
 *   Only rows that are BOTH on one of the 16 tickers the repair touched AND
 *   unlinked. An unlinked row on any OTHER ticker is import-era history and the
 *   ONLY record of that trade: deleting it would destroy 18,275.49 of real
 *   realized P&L across 29 tickers. Those are fixed by repairing
 *   rebuildClosedTrades, not by deletion.
 *
 * SAFETY
 *   Refuses to delete unless every precondition holds, deletes by explicit row
 *   id, and backs the rows up to JSON first.
 */
import { writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const APPLY = process.argv.includes('--apply')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const OLD = ['DISNEY', 'EXXON', 'FORD', 'GOOGLE', 'NIKE', 'NVIDIA', 'PAYPAL', 'TESLA']
const NEW = ['DIS', 'XOM', 'F', 'GOOGL', 'NKE', 'NVDA', 'PYPL', 'TSLA']
const AFFECTED = [...OLD, ...NEW]

/** The repair superseded exactly this many rows. Anything else means stop. */
const EXPECTED_STALE_ROWS = 19
/** Largest P&L gap tolerated between the stale set and the linked set. */
const PNL_TOLERANCE = 0.05

const n = (v: any) => Number(v ?? 0)
const pnlOf = (rs: any[]) => rs.reduce((s, r) => s + n(r.proceeds) - n(r.invested), 0)
const short = (id: any) => String(id ?? '').slice(0, 8)

function die(msg: string): never {
  console.error(`\nABORTED — ${msg}`)
  console.error('Nothing was deleted.\n')
  process.exit(1)
}

async function main() {
  console.log(`\n${'='.repeat(100)}`)
  console.log(APPLY ? '*** APPLY MODE — THIS WILL DELETE ROWS ***' : 'DRY RUN — nothing will be deleted (pass --apply to delete)')
  console.log('='.repeat(100))

  const { data: onAffected, error } = await supabase
    .from('closed_trades').select('*').in('ticker', AFFECTED)
  if (error) die(`reading closed_trades: ${error.message}`)

  const stale = (onAffected ?? []).filter(r => r.transaction_id == null)
  const linked = (onAffected ?? []).filter(r => r.transaction_id != null)

  console.log('\n--- PRECONDITIONS ---')
  const checks: Array<[string, boolean, string]> = []

  checks.push([
    `stale rows on affected tickers == ${EXPECTED_STALE_ROWS}`,
    stale.length === EXPECTED_STALE_ROWS,
    `found ${stale.length}`,
  ])

  const users = Array.from(new Set(stale.map(r => r.user_id)))
  checks.push(['all stale rows belong to ONE user', users.length === 1, `found ${users.length} user(s)`])

  checks.push([
    'a linked row exists for every stale row',
    linked.length === stale.length,
    `${linked.length} linked vs ${stale.length} stale`,
  ])

  const staleP = pnlOf(stale), linkedP = pnlOf(linked)
  checks.push([
    'stale P&L equals the linked P&L that replaced it',
    Math.abs(staleP - linkedP) <= PNL_TOLERANCE,
    `stale ${staleP.toFixed(4)} vs linked ${linkedP.toFixed(4)}`,
  ])

  const { data: oldTx, error: txErr } = await supabase
    .from('transactions').select('id').in('ticker', OLD)
  if (txErr) die(`reading transactions: ${txErr.message}`)
  checks.push([
    'no transaction still carries an old ticker string',
    (oldTx ?? []).length === 0,
    `found ${(oldTx ?? []).length}`,
  ])

  let failed = false
  for (const [label, ok, detail] of checks) {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label.padEnd(52)} ${detail}`)
    if (!ok) failed = true
  }
  if (failed) die('a precondition does not hold — the data is not in the state this script was written for')

  const userId = users[0]

  // Whole-table position for this user, before and expected after
  const { data: allForUser, error: allErr } = await supabase
    .from('closed_trades').select('*').eq('user_id', userId)
  if (allErr) die(`reading user's closed_trades: ${allErr.message}`)
  const beforeTotal = pnlOf(allForUser ?? [])
  const expectedAfter = beforeTotal - staleP

  console.log('\n--- ROWS TO DELETE ---')
  console.log('TICKER   OPEN        CLOSE          QUANTITY     AVG_COST     INVESTED     PROCEEDS          PNL  ID')
  for (const r of stale.sort((a, b) => String(a.ticker).localeCompare(String(b.ticker)))) {
    console.log(
      `${String(r.ticker).padEnd(8)} ${r.open_date}  ${r.close_date} ${n(r.quantity).toFixed(4).padStart(12)} ` +
      `${n(r.avg_cost).toFixed(2).padStart(12)} ${n(r.invested).toFixed(2).padStart(12)} ${n(r.proceeds).toFixed(2).padStart(12)} ` +
      `${(n(r.proceeds) - n(r.invested)).toFixed(2).padStart(12)}  ${short(r.id)}`
    )
  }

  console.log('\n--- EFFECT ---')
  console.log(`  user                                 : ${short(userId)}`)
  console.log(`  closed_trades rows now               : ${(allForUser ?? []).length}`)
  console.log(`  rows to delete                       : ${stale.length}`)
  console.log(`  rows after                           : ${(allForUser ?? []).length - stale.length}`)
  console.log(`  realized P&L now (inflated)          : ${beforeTotal.toFixed(4)}`)
  console.log(`  realized P&L after                   : ${expectedAfter.toFixed(4)}`)
  console.log('\n  Untouched by design: unlinked rows on every OTHER ticker. Those are the')
  console.log('  only record of those trades — they are fixed in rebuildClosedTrades, not here.')

  if (!APPLY) {
    console.log(`\n${'='.repeat(100)}`)
    console.log('DRY RUN COMPLETE — nothing deleted. Re-run with --apply to execute.')
    console.log('='.repeat(100) + '\n')
    return
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = `./stale-closed-trades-backup-${stamp}.json`
  writeFileSync(backupPath, JSON.stringify({ takenAt: new Date().toISOString(), deleted: stale, beforeTotal, expectedAfter }, null, 2))
  console.log(`\nBackup written: ${backupPath}`)

  console.log('\n--- DELETING ---')
  let deleted = 0
  for (const r of stale) {
    const { error: delErr, count } = await supabase
      .from('closed_trades')
      .delete({ count: 'exact' })
      .eq('id', r.id)
      .is('transaction_id', null)   // guard: never delete a linked row
    if (delErr) die(`deleting ${r.id}: ${delErr.message} (backup at ${backupPath})`)
    if (count && count > 0) deleted++
  }
  console.log(`  deleted: ${deleted}`)

  const { data: after, error: afterErr } = await supabase
    .from('closed_trades').select('*').eq('user_id', userId)
  if (afterErr) die(`verifying: ${afterErr.message}`)
  const afterTotal = pnlOf(after ?? [])

  console.log(`\n${'='.repeat(100)}`)
  console.log('VERIFICATION')
  console.log('='.repeat(100))
  const rowsOk = (after ?? []).length === (allForUser ?? []).length - stale.length
  const pnlOk = Math.abs(afterTotal - expectedAfter) <= 0.01
  console.log(`  ${rowsOk ? 'OK  ' : 'FAIL'}  row count        expected ${(allForUser ?? []).length - stale.length}   actual ${(after ?? []).length}`)
  console.log(`  ${pnlOk ? 'OK  ' : 'FAIL'}  realized P&L     expected ${expectedAfter.toFixed(4)}   actual ${afterTotal.toFixed(4)}`)

  const stillStale = (after ?? []).filter(r => r.transaction_id == null && AFFECTED.includes(r.ticker))
  console.log(`  ${stillStale.length === 0 ? 'OK  ' : 'FAIL'}  no stale row left on an affected ticker: ${stillStale.length}`)

  console.log()
  if (!rowsOk || !pnlOk || stillStale.length > 0) {
    console.error(`FAILED — backup at ${backupPath}. Stop and review.\n`)
    process.exit(1)
  }
  console.log('Cleanup complete and verified.')
  console.log(`Backup kept at ${backupPath} — move it somewhere safe.\n`)
  console.log('STILL OPEN: 33 unlinked closed_trades on other tickers (18,275.49) and 2 in')
  console.log('on_closed_trades (1,043.89) duplicate on the next rebuild of their ticker.')
  console.log('The fix for those is in rebuildClosedTrades, not deletion.\n')
}

main().catch(err => { console.error('FAILED:', err); process.exit(1) })
