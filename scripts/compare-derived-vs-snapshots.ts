/**
 * READ-ONLY shadow compare: the derived history against the measured snapshots.
 *
 * Computes the derived series from scratch (no derived:v1 read or write), reads the
 * snapshots, and evaluates the cutover gate (REQ-15, G1-G4). Exit 0 = gate passes,
 * 1 = gate fails or the derivation was degraded, 2 = bad usage.
 *
 * Run with: npx tsx --env-file=.env scripts/compare-derived-vs-snapshots.ts --user <userId>
 * Needs >= 5 market days of on_price_history for G4. Writes nothing to the database.
 */
import { createClient } from '@supabase/supabase-js'
import { evaluateGate, MIN_ON_DATES, type GateResult } from '../src/lib/derive-gate'
import type { DerivedRow, DeriveFlags, SplitEvent } from '../src/lib/derive-history'
import type { BarsResult } from '../src/lib/bars-cache'
import type { PortfolioSnapshot } from '../src/types'
import type { ReplayMovement, ReplayTransaction } from '../src/lib/portfolio-replay'

export function parseArgs(argv: string[]): { userId: string } | { error: string } {
  const i = argv.indexOf('--user')
  const userId = i >= 0 ? argv[i + 1] : undefined
  if (!userId || userId.startsWith('--')) return { error: 'Usage: compare-derived-vs-snapshots.ts --user <userId>' }
  return { userId }
}

export interface CompareDeps {
  today: string
  derive(): Promise<{ rows: DerivedRow[]; degraded: boolean; flags: DeriveFlags; splits: SplitEvent[] }>
  readSnapshots(): Promise<PortfolioSnapshot[]>
  readLedger(): Promise<{ transactions: ReplayTransaction[]; movements: ReplayMovement[] }>
  /** total_value of the stored positions at the same quotes (computeLiveSnapshotRow), null = none. */
  liveTotal(): Promise<number | null>
  onFirstPriceDate(): Promise<string | null>
  now(): number
  log(line: string): void
}

const money = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(2)

function printGate(log: CompareDeps['log'], r: GateResult) {
  log('')
  for (const [name, c] of Object.entries(r.checks)) log(`${c.pass ? 'PASS' : 'FAIL'}  ${name}  ${c.detail}`)
  log(r.pass ? `GATE PASSED (G4 needs >= ${MIN_ON_DATES} live ON dates from the first recorded price)` : 'GATE FAILED')
}

export async function runCompare(deps: CompareDeps): Promise<number> {
  const { log } = deps

  // The first derivation pays for Yahoo and the bars cache; the second one is the steady state.
  const t0 = deps.now()
  const derived = await deps.derive()
  const t1 = deps.now()
  await deps.derive()
  const t2 = deps.now()
  log(`derive: cold ${t1 - t0} ms, warm ${t2 - t1} ms (no derived cache)`)

  if (derived.degraded) {
    log('DEGRADED: the derived series is incomplete (stale/missing bars, unknown splits, no CCL, unpriced stock today or a failed read); re-run when the sources are healthy.')
    return 1
  }

  const [snapshots, ledger, liveTotal, onFirstPriceDate] = await Promise.all([
    deps.readSnapshots(), deps.readLedger(), deps.liveTotal(), deps.onFirstPriceDate(),
  ])
  const result = evaluateGate({
    today: deps.today, derived: derived.rows, snapshots,
    transactions: ledger.transactions, movements: ledger.movements, splits: derived.splits,
    liveTotal, onFirstPriceDate,
  })

  log('')
  log('date        src        dStocks+Cash      dTotal       dOns   reason')
  for (const d of result.diffs) {
    const differs = [d.dStocksCash, d.dTotal, d.dOns].some(x => Math.abs(x) > 1)
    if (!differs) continue
    log(`${d.date}  ${d.source.padEnd(9)} ${money(d.dStocksCash).padStart(12)} ${money(d.dTotal).padStart(11)} ${money(d.dOns).padStart(10)}   ${d.reason ?? 'UNEXPLAINED'}`)
  }
  log(`${result.diffs.length} dates compared, ${result.diffs.filter(d => d.reason).length} explained`)
  log(`dates missing from derived: ${result.missingInDerived.length ? result.missingInDerived.join(', ') : 'none'}`)
  if (result.skippedNoBreakdown.length) log(`snapshots without breakdown (skipped): ${result.skippedNoBreakdown.join(', ')}`)
  log(`onAggregateMarkDays: ${derived.flags.onAggregateMarkDays}/${snapshots.filter(s => s.source === 'live').length} live dates (informational, circular for G4)`)
  const f = derived.flags
  log(`flags: negativeCash=${f.negativeCash ? `${f.negativeCash.date} ${f.negativeCash.cash.toFixed(2)}` : 'none'} costMarkedStocks=[${f.costMarkedStocks}] vanished=[${f.vanished}] todayUnpriced=[${f.todayUnpriced}]`)
  printGate(log, result)
  return result.pass ? 0 : 1
}

// --- wiring (not covered by tests: needs the real database) -----------------------------

const PAGE = 1000
async function readAll<T>(build: () => any, order: string): Promise<T[]> {
  const out: T[] = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await build().order(order, { ascending: true }).range(offset, offset + PAGE - 1)
    if (error) throw new Error(error.message)
    out.push(...((data ?? []) as T[]))
    if ((data ?? []).length < PAGE) return out
  }
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2))
  if ('error' in parsed) {
    console.error(parsed.error)
    process.exit(2)
  }
  const { userId } = parsed

  // Imported here so that importing this file (tests) never loads Redis or Yahoo.
  const { getDerivedSeries } = await import('../src/lib/derived-series')
  const { getBars } = await import('../src/lib/bars-cache')
  const { fetchSnapshotSeries } = await import('../src/lib/snapshot-series')
  const { computeLiveSnapshotRow } = await import('../src/lib/portfolio-snapshots')
  const { listCatalogued } = await import('../src/lib/ticker-catalog')
  const { normalizeTickerForYahoo } = await import('../src/lib/yahoo-finance')
  const { argentinaDate } = await import('../src/lib/utils')

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const today = argentinaDate()

  const readLedger = async () => ({
    transactions: await readAll<ReplayTransaction>(
      () => supabase.from('transactions').select('ticker, operation, quantity, price, commission, date, asset_type, created_at').eq('user_id', userId), 'id'),
    movements: await readAll<ReplayMovement>(
      () => supabase.from('cash_movements').select('type, amount, date, created_at').eq('user_id', userId), 'id'),
  })

  const derive = async () => {
    const captured = new Map<string, BarsResult>()
    const series = await getDerivedSeries(supabase, userId, {}, {
      skipCache: true,
      getBars: async (symbols, from) => {
        const res = await getBars(symbols, from)
        res.forEach((v, k) => captured.set(k, v))
        return res
      },
    })
    // Split events are keyed by Yahoo symbol; map them back to portfolio tickers the way derived-series does.
    const catalog = new Map((await listCatalogued(supabase)).map(r => [String(r.ticker).trim().toUpperCase(), String(r.yahoo_symbol).trim()]))
    const { transactions } = await readLedger()
    const splits: SplitEvent[] = []
    for (const ticker of new Set(transactions.map(t => String(t.ticker).trim().toUpperCase()))) {
      const symbol = catalog.get(ticker) ?? normalizeTickerForYahoo(ticker)
      for (const s of captured.get(symbol)?.splits ?? []) splits.push({ ticker, date: s.date })
    }
    return { ...series, splits }
  }

  const code = await runCompare({
    today,
    derive,
    readSnapshots: () => fetchSnapshotSeries(supabase, userId),
    readLedger,
    liveTotal: async () => (await computeLiveSnapshotRow(supabase, userId, today))?.total_value ?? null,
    onFirstPriceDate: async () => {
      const { data, error } = await supabase.from('on_price_history').select('price_date').order('price_date', { ascending: true }).limit(1)
      if (error) throw new Error(error.message)
      return data?.[0]?.price_date ? String(data[0].price_date).slice(0, 10) : null
    },
    now: () => Date.now(),
    log: l => console.log(l),
  })
  process.exit(code)
}

if (process.argv[1]?.includes('compare-derived-vs-snapshots')) {
  main().catch(err => {
    console.error(err)
    process.exit(1)
  })
}
