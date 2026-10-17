/**
 * READ-ONLY shadow compare: the derived history against the measured snapshots.
 *
 * Computes the derived series from scratch (no derived:v1 read or write), reads the
 * snapshots, and evaluates the cutover gate (REQ-15, G1-G4). Exit codes:
 *   0 gate passes | 1 gate fails | 2 bad usage | 3 derivation degraded (re-run when sources are healthy)
 *
 * Writes nothing to the database, and the Yahoo bars go through a MEMORY-ONLY cache: the shared
 * Redis `bars:v1:*` keys are neither read nor written. Quotes are read from the existing LKP cache
 * (read-only); the library's historical-CCL helper may still write its own deterministic
 * `ccl:*` cache entry, exactly as the app would.
 *
 * Run with: npx tsx --env-file=.env scripts/compare-derived-vs-snapshots.ts --user <userId>
 * Needs >= 5 market days of on_price_history for G4.
 */
import { createClient } from '@supabase/supabase-js'
import { evaluateGate, MIN_ON_DATES, type GateResult, type KnownAt } from '../src/lib/derive-gate'
import { deriveHistory, knownAtFrom, type DerivedRow, type DeriveFlags, type DeriveInput } from '../src/lib/derive-history'
import type { PortfolioSnapshot } from '../src/types'

export const EXIT_PASS = 0
export const EXIT_GATE_FAILED = 1
export const EXIT_USAGE = 2
export const EXIT_DEGRADED = 3

export function parseArgs(argv: string[]): { userId: string } | { error: string } {
  const i = argv.indexOf('--user')
  const userId = i >= 0 ? argv[i + 1] : undefined
  if (!userId || userId.startsWith('--')) return { error: 'Usage: compare-derived-vs-snapshots.ts --user <userId>' }
  return { userId }
}

export interface CompareDeps {
  today: string
  derive(): Promise<{ rows: DerivedRow[]; degraded: boolean; flags: DeriveFlags; knownAt: (date: string) => KnownAt | null }>
  readSnapshots(): Promise<PortfolioSnapshot[]>
  /** total_value of the stored positions at the same quotes (computeLiveSnapshotRow), null = none. */
  liveTotal(): Promise<number | null>
  /** Distinct on_price_history.price_date. */
  onPriceDates(): Promise<string[]>
  now(): number
  log(line: string): void
}

const money = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(2)

function printGate(log: CompareDeps['log'], r: GateResult) {
  log('')
  for (const [name, c] of Object.entries(r.checks)) log(`${c.pass ? 'PASS' : 'FAIL'}  ${name}  ${c.detail}`)
  log(r.pass ? `GATE PASSED (G4 needs >= ${MIN_ON_DATES} live ON dates with captured prices)` : 'GATE FAILED')
}

export async function runCompare(deps: CompareDeps): Promise<number> {
  const { log } = deps

  // The first derivation pays for Yahoo and the bars cache; the second one is the steady state.
  const t0 = deps.now()
  const derived = await deps.derive()
  const t1 = deps.now()
  // Read right after the first derive: both are priced at (nearly) the same quotes.
  const liveTotal = await deps.liveTotal()
  await deps.derive()
  const t2 = deps.now()
  log(`derive: cold ${t1 - t0} ms, warm ${t2 - t1} ms (no derived cache)`)

  if (derived.degraded) {
    log('DEGRADED: the derived series is incomplete (stale/missing bars, unknown splits, no CCL, unpriced stock today or a failed read); re-run when the sources are healthy.')
    return EXIT_DEGRADED
  }

  const [snapshots, onPriceDates] = await Promise.all([deps.readSnapshots(), deps.onPriceDates()])
  const result = evaluateGate({
    today: deps.today, derived: derived.rows, snapshots, liveTotal, onPriceDates,
    onMarkDates: derived.flags.onAggregateMarkDates, knownAt: derived.knownAt,
  })

  log('')
  log('date        src        dStocks+Cash      dTotal       dOns   reasons (stocks+cash / total / ons)')
  for (const d of result.diffs) {
    if (Object.values(d.reasons).every(r => r === null)) continue
    const reasons = [d.reasons.stocksCash, d.reasons.total, d.reasons.ons].map(r => (r === 'unexplained' ? 'UNEXPLAINED' : r ?? '-')).join(' / ')
    log(`${d.date}  ${d.source.padEnd(9)} ${money(d.dStocksCash).padStart(12)} ${money(d.dTotal).padStart(11)} ${money(d.dOns).padStart(10)}   ${reasons}`)
  }
  log(`${result.diffs.length} dates compared`)
  log(`corrupt snapshots: ${result.corruptDates.length ? result.corruptDates.join(', ') : 'none'}`)
  log(`dates missing from derived: ${result.missingInDerived.length ? result.missingInDerived.join(', ') : 'none'}`)
  if (result.skippedNoBreakdown.length) log(`snapshots without breakdown (skipped): ${result.skippedNoBreakdown.join(', ')}`)
  log(`ON aggregate-mark dates (excluded from G4, circular): ${derived.flags.onAggregateMarkDates.length ? derived.flags.onAggregateMarkDates.join(', ') : 'none'}`)
  const f = derived.flags
  log(`flags: negativeCash=${f.negativeCash ? `${f.negativeCash.date} ${f.negativeCash.cash.toFixed(2)}` : 'none'} costMarkedStocks=[${f.costMarkedStocks}] vanished=[${f.vanished}] todayUnpriced=[${f.todayUnpriced}]`)
  printGate(log, result)
  return result.pass ? EXIT_PASS : EXIT_GATE_FAILED
}

// --- wiring ------------------------------------------------------------------------------

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

/** The library pieces the wiring uses, injectable so tests never load Redis or Yahoo. */
export interface CompareLib {
  getDerivedSeries: typeof import('../src/lib/derived-series').getDerivedSeries
  getBars: typeof import('../src/lib/bars-cache').getBars
  fetchSnapshotSeries: typeof import('../src/lib/snapshot-series').fetchSnapshotSeries
  computeLiveSnapshotRow: typeof import('../src/lib/portfolio-snapshots').computeLiveSnapshotRow
  /** Extra DerivedDeps (tests inject quotes/CCL). */
  derivedDeps?: import('../src/lib/derived-series').DerivedDeps
}

/** Read-only wiring: only select queries; bars through the memory-only cache. */
export function buildCompareDeps(supabase: any, userId: string, today: string, lib: CompareLib): CompareDeps {
  return {
    today,
    derive: async () => {
      let captured: DeriveInput | undefined
      const series = await lib.getDerivedSeries(supabase, userId, {}, {
        ...lib.derivedDeps,
        skipCache: true,
        getBars: (symbols, from) => lib.getBars(symbols, from, { memoryOnly: true }),
        derive: input => { captured = input; return deriveHistory(input) },
      })
      return { ...series, knownAt: captured ? knownAtFrom(captured) : () => null }
    },
    readSnapshots: () => lib.fetchSnapshotSeries(supabase, userId),
    liveTotal: async () => (await lib.computeLiveSnapshotRow(supabase, userId, today))?.total_value ?? null,
    onPriceDates: async () => {
      const rows = await readAll<{ price_date: string }>(() => supabase.from('on_price_history').select('price_date'), 'price_date')
      return Array.from(new Set(rows.map(r => String(r.price_date).slice(0, 10))))
    },
    now: () => Date.now(),
    log: l => console.log(l),
  }
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2))
  if ('error' in parsed) {
    console.error(parsed.error)
    process.exit(EXIT_USAGE)
  }

  // Imported here so that importing this file (tests) never loads Redis or Yahoo.
  const { getDerivedSeries } = await import('../src/lib/derived-series')
  const { getBars } = await import('../src/lib/bars-cache')
  const { fetchSnapshotSeries } = await import('../src/lib/snapshot-series')
  const { computeLiveSnapshotRow } = await import('../src/lib/portfolio-snapshots')
  const { argentinaDate } = await import('../src/lib/utils')

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const deps = buildCompareDeps(supabase, parsed.userId, argentinaDate(), { getDerivedSeries, getBars, fetchSnapshotSeries, computeLiveSnapshotRow })
  process.exit(await runCompare(deps))
}

if (process.argv[1]?.includes('compare-derived-vs-snapshots')) {
  main().catch(err => {
    console.error(err)
    process.exit(1)
  })
}
