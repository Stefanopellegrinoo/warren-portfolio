// scripts/backfill-trade-record.ts
/**
 * Reconstructs the trade record (migration 044) of one user's rows that have
 * none yet (trade_currency IS NULL). Rules: src/lib/trade-record-backfill.ts.
 *
 * DRY-RUN BY DEFAULT: prints a summary and one CSV line per planned update.
 *
 *   npx tsx --env-file=.env scripts/backfill-trade-record.ts --user <uuid>
 *   npx tsx --env-file=.env scripts/backfill-trade-record.ts --user <uuid> --apply
 *   npx tsx --env-file=.env scripts/backfill-trade-record.ts --user <uuid> --restore <backup.json>
 *
 * --apply first writes ./trade-record-backup-<stamp>.json with the current
 * value of every 044 column of the affected rows, then writes all planned rows
 * in ONE call to apply_trade_record_backfill (one transaction; it touches only
 * the 044 columns and fails whole if any row is missing). --restore writes a
 * backup back through the same function.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fxLookupFrom, planTradeRecordBackfill, type LedgerRow, type TradeRecordUpdate } from '../src/lib/trade-record-backfill'

export const RECORD_COLUMNS = [
  'trade_currency', 'trade_quantity', 'trade_price', 'trade_commission', 'cedear_ratio',
  'fx_mep', 'fx_ccl', 'fx_date', 'fx_source', 'needs_review', 'review_note',
] as const
const LEDGER_COLUMNS = ['id', 'date', 'ticker', 'operation', 'asset_type', 'moneda', 'quantity', 'price', 'commission', 'created_at'] as const
const PAGE = 1000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type Args = { user: string; apply: boolean; restore: string | null }

export function parseArgs(argv: string[]): Args | { error: string } {
  const value = (flag: string) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] ?? '' : null }
  const user = value('--user')
  if (!user || !UUID.test(user)) return { error: 'usage: --user <uuid> [--apply | --restore <backup.json>]' }
  const restore = value('--restore')
  if (restore === '') return { error: '--restore needs the backup path' }
  if (restore && argv.includes('--apply')) return { error: '--apply and --restore are exclusive' }
  return { user, apply: argv.includes('--apply'), restore }
}

export interface Deps {
  client: SupabaseClient
  log: (line: string) => void
  writeFile: (path: string, data: string) => void
  readFile: (path: string) => string
  stamp: () => string
}

async function readAll<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < PAGE) return out
  }
}

const csv = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

async function writeRows(client: SupabaseClient, user: string, rows: unknown[]): Promise<number> {
  const { data, error } = await client.rpc('apply_trade_record_backfill', { p_user_id: user, p_rows: rows })
  if (error) throw new Error(`apply_trade_record_backfill: ${error.message}`)
  return Number(data)
}

export async function run(args: Args, { client, log, writeFile, readFile, stamp }: Deps): Promise<number> {
  if (args.restore) {
    const backup = JSON.parse(readFile(args.restore)) as { user: string; rows: unknown[] }
    if (backup.user !== args.user) throw new Error(`backup belongs to ${backup.user}, not ${args.user}`)
    log(`Restored ${await writeRows(client, args.user, backup.rows)} rows from ${args.restore}`)
    return 0
  }

  const [ledger, fxRows, cedears] = await Promise.all([
    readAll<LedgerRow & Record<string, unknown>>((a, b) => client.from('transactions')
      .select([...LEDGER_COLUMNS, ...RECORD_COLUMNS].join(','))
      .eq('user_id', args.user).is('trade_currency', null).order('date').order('id').range(a, b) as never),
    readAll<{ date: string; kind: 'mep' | 'ccl'; buy: number; sell: number }>((a, b) =>
      client.from('fx_rates').select('date,kind,buy,sell').order('date').order('kind').range(a, b) as never),
    readAll<{ ticker: string; ratio: number }>((a, b) => client.from('cedears').select('ticker,ratio').order('ticker').range(a, b) as never),
  ])
  const rows = ledger.map(r => ({ ...r, quantity: Number(r.quantity), price: Number(r.price), commission: Number(r.commission) }))
  const ratios = new Map(cedears.filter(c => Number(c.ratio) > 0).map(c => [c.ticker, Number(c.ratio)]))
  const { updates, skipped } = planTradeRecordBackfill(rows, fxLookupFrom(fxRows), ratios)

  const byId = new Map(rows.map(r => [r.id, r]))
  const count = (pick: (u: TradeRecordUpdate) => string) =>
    Object.entries(updates.reduce<Record<string, number>>((acc, u) => { const k = pick(u); acc[k] = (acc[k] ?? 0) + 1; return acc }, {}))
      .map(([k, n]) => `${k}=${n}`).join(' ')
  log(`User ${args.user}: ${rows.length} rows without a trade record; ${updates.length} planned, ${skipped.length} skipped.`)
  log(`  by asset_type:     ${count(u => byId.get(u.id)!.asset_type)}`)
  log(`  by trade_currency: ${count(u => u.trade_currency ?? 'none')}`)
  log(`  needs_review:      ${updates.filter(u => u.needs_review).length}`)
  for (const s of skipped) log(`  skipped ${s.id}: ${s.reason}`)
  log('')
  log([...LEDGER_COLUMNS, ...RECORD_COLUMNS].join(','))
  for (const u of updates) {
    const r = byId.get(u.id)!
    log([...LEDGER_COLUMNS.map(c => csv(r[c])), ...RECORD_COLUMNS.map(c => csv(u[c]))].join(','))
  }

  if (!args.apply) {
    log('')
    log(`DRY RUN — nothing written. To write: npx tsx --env-file=.env scripts/backfill-trade-record.ts --user ${args.user} --apply`)
    return 0
  }
  if (updates.length === 0) { log('Nothing to write.'); return 0 }

  const backupPath = `./trade-record-backup-${stamp()}.json`
  const before = updates.map(u => Object.fromEntries([['id', u.id], ...RECORD_COLUMNS.map(c => [c, byId.get(u.id)![c] ?? null])]))
  writeFile(backupPath, JSON.stringify({ user: args.user, takenAt: stamp(), rows: before }, null, 2))
  log(`Backup written: ${backupPath}`)
  const written = await writeRows(client, args.user, updates)
  log(`Wrote the trade record of ${written} rows in one transaction.`)
  log(`To undo: npx tsx --env-file=.env scripts/backfill-trade-record.ts --user ${args.user} --restore ${backupPath}`)
  return 0
}

if (process.argv[1]?.includes('backfill-trade-record')) {
  const args = parseArgs(process.argv.slice(2))
  if ('error' in args) { console.error(args.error); process.exit(2) }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) { console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (use --env-file=.env)'); process.exit(2) }
  import('@supabase/supabase-js').then(({ createClient }) => run(args, {
    client: createClient(url, key),
    log: line => console.log(line),
    writeFile: (p, d) => writeFileSync(p, d),
    readFile: p => readFileSync(p, 'utf8'),
    stamp: () => new Date().toISOString().replace(/[:.]/g, '-'),
  })).then(code => process.exit(code), err => { console.error(`FAILED: ${err.message}`); process.exit(1) })
}
