/**
 * Read-only: does the ledger core reproduce what the app stores (holdings, cost,
 * cash, realized P&L)? The cutover gate for dropping the stored tables.
 *
 *   npx tsx --env-file=.env scripts/reconcile-ledger.ts --user <uuid>
 *   npx tsx --env-file=.env scripts/reconcile-ledger.ts --all   (every user with transactions)
 *
 * Exit 0 = reconciled, 1 = mismatch (reasons printed), 2 = usage/read error.
 * Uses the service role (RLS bypass) like backfill-snapshots.ts; performs
 * SELECTs only.
 */
import { createClient } from '@supabase/supabase-js'
import { reconcileLedger } from '../src/lib/ledger-reconciliation'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const i = process.argv.indexOf('--user')
const userId = i >= 0 ? process.argv[i + 1] : undefined
const all = process.argv.includes('--all')

if (!url || !key || (!all && (!userId || userId.startsWith('--')))) {
  console.error('Usage: npx tsx --env-file=.env scripts/reconcile-ledger.ts --user <uuid> | --all (needs Supabase env vars)')
  process.exit(2)
}

const supabase = createClient(url, key)

async function userIds(): Promise<string[]> {
  const ids = new Set<string>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('transactions').select('user_id').order('id').range(from, from + 999)
    if (error) throw new Error(error.message)
    for (const r of data ?? []) ids.add(r.user_id)
    if (!data || data.length < 1000) return [...ids]
  }
}

async function main() {
  let failed = 0
  for (const id of all ? await userIds() : [userId!]) {
    const { ok, reasons } = await reconcileLedger(supabase, id)
    if (ok) {
      console.log(`[Reconcile] ${id}: PASS`)
      continue
    }
    failed++
    console.log(`[Reconcile] ${id}: ${reasons.length} mismatch(es)`)
    reasons.forEach(r => console.log(`  · ${r}`))
  }
  process.exitCode = failed ? 1 : 0
}

main().catch(err => {
  console.error('[Reconcile] read failed:', err instanceof Error ? err.message : err)
  process.exitCode = 2
})
