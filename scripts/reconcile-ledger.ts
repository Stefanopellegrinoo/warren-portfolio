/**
 * Read-only: does replaying a user's ledger reproduce what the app stores?
 *
 *   npx tsx --env-file=.env scripts/reconcile-ledger.ts --user <uuid>
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

if (!url || !key || !userId || userId.startsWith('--')) {
  console.error('Usage: npx tsx --env-file=.env scripts/reconcile-ledger.ts --user <uuid> (needs Supabase env vars)')
  process.exit(2)
}

reconcileLedger(createClient(url, key), userId)
  .then(({ ok, reasons }) => {
    if (ok) {
      console.log(`[Reconcile] ${userId}: PASS`)
      return
    }
    console.log(`[Reconcile] ${userId}: ${reasons.length} mismatch(es)`)
    reasons.forEach(r => console.log(`  · ${r}`))
    process.exitCode = 1
  })
  .catch(err => {
    console.error('[Reconcile] read failed:', err instanceof Error ? err.message : err)
    process.exitCode = 2
  })
