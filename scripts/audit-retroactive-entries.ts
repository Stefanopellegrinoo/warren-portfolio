/**
 * READ-ONLY audit — which measured snapshots a late entry invalidated.
 *
 * Performs SELECTs only. There is no --apply because there is nothing to
 * apply: the backfill's rule that a stored row's totals are never overwritten
 * makes repair impossible by design, and deleting the row does not remove the
 * fabricated day it produced (verified 2026-08-01).
 *
 *   npx tsx --env-file=.env scripts/audit-retroactive-entries.ts
 *   npx tsx --env-file=.env scripts/audit-retroactive-entries.ts --user <FULL-UUID>
 *
 * Pass the FULL uuid. Never abbreviate an identifier into a command.
 */
import { createClient } from '@supabase/supabase-js'
import { staleSnapshots } from '../src/lib/retroactive-entry'
import { isEstimated } from '../src/lib/series-provenance'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase env vars. Run with: npx tsx --env-file=.env scripts/audit-retroactive-entries.ts')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

const userArgIndex = process.argv.indexOf('--user')
// `process.argv[userArgIndex + 1]` is `undefined` when `--user` is the LAST
// token — and `undefined` is falsy, same as "flag absent". Left unguarded,
// that reads as "no filter requested" and silently runs over every user
// instead of the one the operator asked for. Fail closed instead: a missing
// value, or one that is itself another flag, is an argument error, not a
// request for "all users".
const userArgValue = userArgIndex === -1 ? undefined : process.argv[userArgIndex + 1]
if (userArgIndex !== -1 && (userArgValue === undefined || userArgValue.startsWith('--'))) {
  console.error('--user requires a value. Pass the FULL uuid. Never abbreviate an identifier into a command.')
  process.exit(1)
}
const userFilter = userArgIndex === -1 ? null : userArgValue!

/** PostgREST caps a response at 1000 rows; walk the whole table. */
async function fetchAll(table: string, columns: string): Promise<any[]> {
  const PAGE = 1000
  const rows: any[] = []
  for (let from = 0; ; from += PAGE) {
    let query = supabase.from(table).select(columns).range(from, from + PAGE - 1)
    if (userFilter) query = query.eq('user_id', userFilter)
    const { data, error } = await query
    if (error) throw new Error(`${table}: ${error.message}`)
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < PAGE) break
  }
  return rows
}

const money = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

async function main() {
  const [snapshots, transactions] = await Promise.all([
    fetchAll('portfolio_snapshots', 'user_id, snapshot_date, source, total_invested'),
    fetchAll('transactions', 'user_id, date, ticker, operation, quantity, price, created_at'),
  ])

  // Fail closed on a --user that matched nothing AT ALL, rather than reporting
  // a clean run over an empty set. Checking transactions alone would wrongly
  // reject a valid cash-only user (snapshots but no transactions) as a typo.
  if (userFilter && transactions.length === 0 && snapshots.length === 0) {
    console.error(`--user ${userFilter} matched no user`)
    process.exit(1)
  }

  const byUser = new Map<string, any[]>()
  for (const tx of transactions) {
    const key = String(tx.user_id)
    if (!byUser.has(key)) byUser.set(key, [])
    byUser.get(key)!.push(tx)
  }

  const liveRows = snapshots.filter((s) => !isEstimated(s))
  console.log(
    `${snapshots.length} snapshots (${liveRows.length} live), ` +
      `${transactions.length} transactions, ${byUser.size} users\n`
  )

  // date -> the entries that arrived after that row was written.
  const damage = new Map<string, { row: any; offenders: any[] }>()

  for (const row of liveRows) {
    for (const tx of byUser.get(String(row.user_id)) ?? []) {
      const stale = staleSnapshots(tx.date, new Date(tx.created_at), [row])
      if (stale.length === 0) continue
      const key = `${row.user_id}|${row.snapshot_date}`
      if (!damage.has(key)) damage.set(key, { row, offenders: [] })
      damage.get(key)!.offenders.push(tx)
    }
  }

  if (damage.size === 0) {
    console.log(`No measured snapshot was invalidated by a late entry. (${liveRows.length} live rows checked)`)
    return
  }

  console.log('=== measured snapshots invalidated by a late entry ===')
  for (const { row, offenders } of [...damage.values()].sort((a, b) =>
    a.row.snapshot_date.localeCompare(b.row.snapshot_date)
  )) {
    const notional = offenders.reduce(
      (acc, t) => acc + Math.abs(Number(t.quantity)) * Number(t.price),
      0
    )
    console.log(
      // Full UUID, never abbreviated — see the header comment: an invented
      // suffix on a truncated id is exactly the incident this script's own
      // --user guard exists to prevent, and there is no width pressure at
      // one line per damaged row.
      `\n  ${row.snapshot_date}  user ${String(row.user_id)}\n` +
        `    ${offenders.length} operation(s) missing, notional ${money(notional)}\n` +
        `    stored total_invested ${money(Number(row.total_invested))}`
    )
    for (const tx of offenders) {
      const lagDays = (
        (new Date(tx.created_at).getTime() - new Date(`${tx.date}T00:00:00Z`).getTime()) / 86400000
      ).toFixed(1)
      console.log(
        `      ${tx.date}  ${String(tx.operation).padEnd(9)} ${String(tx.ticker).padEnd(8)}` +
          `  entered ${String(tx.created_at).slice(0, 16)} (+${lagDays}d)`
      )
    }
  }

  console.log(
    `\n${damage.size} of ${liveRows.length} live rows invalidated.\n` +
      `Nothing was written. These rows cannot be repaired — see\n` +
      `docs/superpowers/specs/2026-08-03-retroactive-entry-detection-design.md.`
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
