// scripts/backfill-snapshots.ts
/**
 * Reconstructs historical portfolio_snapshots rows.
 *
 * DRY-RUN BY DEFAULT. Pass --apply to write.
 *
 *   npm run backfill                          # report only
 *   npm run backfill -- --apply               # write
 *   npm run backfill -- --user <uuid>         # restrict to one user
 *   npm run backfill -- --from 2026-04-10     # override the range floor (see below)
 *   npm run backfill -- --allow-negative-cash # build even if the ledger's
 *                                             # funding side is missing
 *   npm run backfill -- --allow-price-scale   # continue past mis-keyed
 *                                             # (non-split) recorded prices,
 *                                             # once reconciled separately —
 *                                             # NEVER overrides a split-like
 *                                             # ratio (see below)
 *   npm run backfill -- --fill-breakdown --refill
 *                                             # ALSO recompute rows whose
 *                                             # breakdown is already filled
 *                                             # (see bullet 6 below) — a
 *                                             # deliberate override, not the
 *                                             # default
 *
 * --from overrides the LOWER bound of the reconstructed range: the bar-fetch
 * window and the market calendar (marketDaysFrom) both start there instead of
 * at the earliest transaction. It does NOT truncate the transaction replay —
 * every transaction from the beginning of history still feeds replayPortfolioAt
 * for every day inside the range, or a position bought before --from would
 * vanish from every reconstructed row. Use it to start the backfill only after
 * an asset class or the funding side is actually complete in this database,
 * without re-dating any movement.
 *
 * Safety properties, in order of how much damage they prevent:
 *  1. A Yahoo transport failure ABORTS the whole run (fetchDailyBars throws).
 *     A rate-limit must never be recorded as "no price".
 *  2. A recorded price on a different scale than Yahoo's split-adjusted close
 *     ABORTS the run. A pre-split price valued against an adjusted series is
 *     well-formed, plausible and off by the split ratio — that puts quantity
 *     AND price on different bases, so total_value itself becomes fiction.
 *     --allow-price-scale can NEVER override this case. A mis-keyed
 *     (non-split) price, by contrast, leaves quantity correct — only
 *     total_invested/pnl carry the error — and IS what --allow-price-scale
 *     is for, once reconciled against the broker separately.
 *  3. A user whose replay does not reproduce their stored state is SKIPPED and
 *     reported — never partially backfilled.
 *  4. A ledger whose replayed cash goes materially negative ABORTS the run:
 *     the buys are there but not the deposits that funded them, so the
 *     reconstructed value would be cumulative P&L, not portfolio value.
 *     --allow-negative-cash overrides it, deliberately.
 *  5. An existing snapshot row's TOTALS — total_value, total_invested, pnl,
 *     pnl_pct — are NEVER overwritten, by any mode. No code path in this
 *     script names those four columns in a write once a row exists; normal
 *     mode only INSERTs days that have no row at all, so measured history
 *     always wins on the totals.
 *  6. EXCEPTION, scoped to the five breakdown columns only: --fill-breakdown
 *     UPDATEs stocks_value/stocks_invested/ons_value/ons_invested/cash_value
 *     on rows that already exist — that is its entire purpose, and the totals
 *     rule above still holds (the UPDATE never names a total column). By
 *     default it SKIPS any row whose breakdown is already non-null, so a
 *     correct MEASURED breakdown already on disk is never silently replaced
 *     by a freshly derived one. --refill disables that skip, deliberately,
 *     for the rare case where a stale breakdown must be recomputed on
 *     purpose.
 */
import { createClient } from '@supabase/supabase-js'
import { closeOnOrBefore, fetchDailyBars, type DailyBar } from '../src/lib/historical-prices'
import { replayPortfolioAt, type ReplayMovement, type ReplayTransaction } from '../src/lib/portfolio-replay'
import { reconcileUser } from '../src/lib/backfill-gate'
import { buildBackfillRows, marketDaysFrom } from '../src/lib/backfill-snapshots'
import { normalizeTickerForYahoo } from '../src/lib/yahoo-finance'
import { matchesStoredTotals, deriveMeasuredBreakdown, type Breakdown } from '../src/lib/snapshot-breakdown'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase env vars. Run with: npx tsx --env-file=.env scripts/backfill-snapshots.ts')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

const APPLY = process.argv.includes('--apply')
/** Conscious override of the funding-side guard in buildBackfillRows. */
const ALLOW_NEGATIVE_CASH = process.argv.includes('--allow-negative-cash')
/**
 * Conscious override of the price-scale guard, for mis-keyed (non-split)
 * recorded prices only — a split-like ratio always aborts regardless of this
 * flag. See scaleVerdict / reportAndGatePriceScaleViolations.
 */
const ALLOW_PRICE_SCALE = process.argv.includes('--allow-price-scale')
/**
 * Fill the per-asset-class breakdown on rows that ALREADY EXIST, instead of
 * writing new days. Inverts the day filter (only dates already recorded) and
 * UPDATEs the five breakdown columns, never the totals.
 */
const FILL_BREAKDOWN = process.argv.includes('--fill-breakdown')
/**
 * Deliberate override of the "skip rows that already have a breakdown" rule
 * in fill mode. Without this flag, a row whose stocks_value is already
 * non-null is left untouched — a MEASURED breakdown, once filled correctly,
 * must never be silently replaced by a freshly derived one on a re-run.
 * --refill disables that skip. Use it only when a stale/wrong breakdown must
 * be recomputed on purpose.
 */
const REFILL = process.argv.includes('--refill')
const userArgIndex = process.argv.indexOf('--user')
const ONLY_USER = userArgIndex >= 0 ? process.argv[userArgIndex + 1] : null

// `--user` with no value would leave ONLY_USER undefined and silently disable
// the filter — so `npm run backfill -- --apply --user` (a fat-fingered UUID)
// would write EVERY user instead of the one that was asked for.
if (userArgIndex >= 0 && !ONLY_USER) {
  console.error('[Backfill] --user requires a UUID')
  process.exit(1)
}

const fromArgIndex = process.argv.indexOf('--from')
const FROM = fromArgIndex >= 0 ? process.argv[fromArgIndex + 1] : null

// Same misuse guard as --user: a missing or malformed value must abort rather
// than silently falling back to the derived-from-transactions default — which
// here would silently rebuild the much larger (and, per the funding-guard
// finding, WRONG) range instead of the one actually asked for.
if (fromArgIndex >= 0 && !(FROM && /^\d{4}-\d{2}-\d{2}$/.test(FROM))) {
  console.error(`[Backfill] --from requires a date in YYYY-MM-DD format, got: ${FROM ?? '(missing)'}`)
  process.exit(1)
}

/** Yahoo is rate-limited; one call per ticker for the whole range, spaced out. */
const FETCH_DELAY_MS = 250

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * PostgREST caps a response at 1000 rows — walk the whole table.
 *
 * This is NOT optional here: the backfill writes ~1150 rows per user, so an
 * unpaginated read of portfolio_snapshots returns an arbitrary 1000 of them on
 * every run after the first. The dry run would then report ~150 days still to
 * write (a lie), and --apply would collide with unique(user_id, snapshot_date)
 * and abort — destroying both the safe-second-run property and the
 * self-healing-on-rerun argument that justifies non-atomic chunked inserts.
 * The convention is already written twice in this directory: see
 * scripts/audit-ticker-names.ts and scripts/diag-closed-trades-scope.ts.
 */
const PAGE = 1000

/**
 * Paginating without ORDER BY is not pagination — Postgres guarantees nothing
 * about row order across two LIMIT/OFFSET queries, so a row can be served twice
 * or not at all. `orderBy` must therefore be a column that totally orders the
 * scoped rows; every call site here passes a primary key or a per-user unique
 * column.
 *
 * The dangerous case is not the obvious one. A DROPPED COMPRA on a ticker that
 * is already closed today leaves calculateRunningAvgCost discarding the orphan
 * VENTA at its `quantity > 0` guard, so TODAY's replayed state still matches
 * storage and the reconciliation gate PASSES — while the position silently
 * disappears from every historical day it was actually held. Nothing after this
 * point can detect that.
 */
async function selectAll<T>(table: string, columns: string, userId: string, orderBy: string): Promise<T[]> {
  const rows: T[] = []

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .eq('user_id', userId)
      .order(orderBy, { ascending: true })
      .range(from, from + PAGE - 1)

    if (error) throw new Error(`[Backfill] read of ${table} failed for ${userId}: ${error.message}`)

    const page = (data ?? []) as T[]
    rows.push(...page)
    if (page.length < PAGE) return rows
  }
}

/**
 * ── Price-scale guard ─────────────────────────────────────────────────────
 *
 * Yahoo's historical `close` is SPLIT-ADJUSTED; a price recorded before a split
 * is not. Valuing a position against a cost basis on a different scale produces
 * a well-formed, plausible, catastrophically wrong number — NVIDIA recorded at
 * 189-446 against an adjusted ~18-44 would have burned a fabricated -90% into
 * this history. CLAUDE.md: "any new historical-price consumer must re-run that
 * probe before trusting a close". This is that consumer, and this is that probe,
 * inlined so a split-like ratio ALWAYS aborts the run; a mis-keyed (non-split)
 * ratio is reported and can be allowed to proceed with --allow-price-scale.
 *
 * Same band scripts/audit-price-scale.ts uses: outside it, the ratio names the
 * split (~10, ~20, ~3) or the currency (a BCBA `.BA` symbol priced in ARS
 * against a USD cost basis lands near 1/1000).
 */
const SCALE_RATIO_MIN = 0.93
const SCALE_RATIO_MAX = 1.07

/**
 * Test account — impossible states, seed rows, no transactions behind them.
 * scripts/audit-price-scale.ts excludes the same UUID for the same reason.
 * The reconciliation gate above should already skip this account before we
 * ever reach here; this is defence in depth so one bad test account can never
 * abort every OTHER user's backfill via reportAndGatePriceScaleViolations's throw.
 */
const TEST_USER = '94b2edc8-5376-4233-87b4-e650c0d97b92'

/**
 * What a scale factor means, so both the report and the abort message are
 * actionable. `isSplit` is the load-bearing bit: it is what decides whether
 * --allow-price-scale is even allowed to apply. A split-like ratio puts
 * quantity AND price on different bases, so total_value itself becomes
 * fiction — the override is explicitly not meant to cover that. A ratio that
 * is NOT split-like is a mis-keyed (non-split) price: quantity stays correct,
 * only total_invested/pnl carry the error, which IS what the override covers.
 */
interface ScaleVerdict {
  isSplit: boolean
  message: string
}

function scaleVerdict(ratio: number): ScaleVerdict {
  const SPLITS: Array<[number, string]> = [
    [2, '2:1'], [3, '3:1'], [4, '4:1'], [5, '5:1'], [10, '10:1'], [20, '20:1'], [30, '30:1'],
  ]
  for (const [n, label] of SPLITS) {
    if (ratio > n * SCALE_RATIO_MIN && ratio < n * SCALE_RATIO_MAX) {
      return { isSplit: true, message: `recorded price is PRE-SPLIT ${label}` }
    }
    if (ratio > (1 / n) * SCALE_RATIO_MIN && ratio < (1 / n) * SCALE_RATIO_MAX) {
      return { isSplit: true, message: `recorded price is BELOW Yahoo by ${label}` }
    }
  }
  return { isSplit: false, message: 'not a clean split ratio — different instrument or different currency' }
}

/** One recorded price that sits on a different scale than Yahoo's close for that day. */
interface PriceScaleViolation {
  ticker: string
  symbol: string
  date: string
  recorded: number
  close: number
  ratio: number
  verdict: ScaleVerdict
}

/**
 * Returns every recorded price for `ticker` that sits on a different scale
 * than the bar Yahoo returns for that day — ALL of them, not just the first,
 * so the operator can decide once against the full picture instead of
 * discovering violations one aborted run at a time.
 *
 * A transaction whose date has no bar on or before it is skipped: there is
 * nothing to compare, and closeOnOrBefore returning null is the documented
 * "the series starts later" case, not a failure.
 */
function findPriceScaleViolations(
  ticker: string,
  symbol: string,
  bars: DailyBar[],
  txs: ReplayTransaction[]
): PriceScaleViolation[] {
  const violations: PriceScaleViolation[] = []

  for (const tx of txs) {
    const date = String(tx.date).slice(0, 10)
    const close = closeOnOrBefore(bars, date)
    if (close === null) continue

    const recorded = Number(tx.price)
    const ratio = recorded / close

    if (ratio > SCALE_RATIO_MIN && ratio < SCALE_RATIO_MAX) continue

    violations.push({ ticker, symbol, date, recorded, close, ratio, verdict: scaleVerdict(ratio) })
  }

  return violations
}

/**
 * Reports every price-scale violation found across the whole ticker scan as a
 * table, then decides ONCE against the full picture:
 *
 *  - A split-like ratio (see ScaleVerdict) ALWAYS aborts, flag or no flag — a
 *    split puts quantity and price on different bases, so total_value itself
 *    becomes fiction, which --allow-price-scale is not meant to cover.
 *  - A mis-keyed (non-split) violation aborts too, UNLESS --allow-price-scale
 *    is set, in which case it is reported and the run continues past it.
 */
function reportAndGatePriceScaleViolations(violations: PriceScaleViolation[]): void {
  if (violations.length === 0) return

  console.log(`  price-scale check: ${violations.length} violation(s) found`)
  console.table(
    violations.map(v => ({
      ticker: v.ticker,
      symbol: v.symbol,
      date: v.date,
      recorded: v.recorded.toFixed(2),
      close: v.close.toFixed(2),
      ratio: v.ratio.toFixed(3),
      split: v.verdict.isSplit ? 'yes' : 'no',
    }))
  )

  const splits = violations.filter(v => v.verdict.isSplit)
  const nonSplits = violations.filter(v => !v.verdict.isSplit)

  if (splits.length > 0) {
    throw new Error(
      `[Backfill] ${splits.length} of ${violations.length} price-scale violation(s) look like a SPLIT ` +
        `(see table above: ${splits.map(v => `${v.ticker} ${v.date}`).join(', ')}). ` +
        '--allow-price-scale does NOT override this, on purpose: a split puts quantity and price on ' +
        'different bases, so total_value itself becomes fiction — not just total_invested/pnl, which is ' +
        'all the override is meant to cover. Fix the DATA (see scripts/audit-price-scale.ts) before backfilling.'
    )
  }

  if (nonSplits.length > 0 && !ALLOW_PRICE_SCALE) {
    throw new Error(
      `[Backfill] ${nonSplits.length} price-scale violation(s) found (see table above), none split-like. ` +
        'Valuing these positions against Yahoo would fossilise a mis-keyed total_invested/pnl into ' +
        'portfolio_snapshots (total_value is unaffected — quantity is correct). Reconcile them against ' +
        'the broker, then re-run with --allow-price-scale to proceed, or fix the DATA ' +
        '(see scripts/audit-price-scale.ts).'
    )
  }

  if (nonSplits.length > 0 && ALLOW_PRICE_SCALE) {
    console.log(
      `  --allow-price-scale: continuing past ${nonSplits.length} non-split violation(s) (see table above)`
    )
  }
}

/**
 * ticker string → Yahoo symbol, human-confirmed.
 *
 * ticker_identity exists precisely so a ticker string cannot be priced as an
 * unrelated instrument (`UN` once resolved to a 2x daily ETF and invented
 * +$18,977). A failed READ throws rather than degrading to "not catalogued":
 * an outage must never be mistaken for a miss.
 */
async function fetchTickerCatalog(): Promise<Map<string, string>> {
  const catalog = new Map<string, string>()

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('ticker_identity')
      .select('ticker, yahoo_symbol')
      .order('ticker', { ascending: true })
      .range(from, from + PAGE - 1)

    if (error) throw new Error(`[Backfill] could not read ticker_identity: ${error.message}`)

    const page = (data ?? []) as { ticker: string; yahoo_symbol: string }[]
    for (const row of page) {
      catalog.set(String(row.ticker).trim().toUpperCase(), String(row.yahoo_symbol).trim())
    }
    if (page.length < PAGE) return catalog
  }
}

/**
 * Same 1000-row cap applies to user enumeration, which has no user_id to
 * scope by. Past 1000 rows an unpaginated read would silently drop whichever
 * users fall past the cutoff and report success for the rest — and, without an
 * ORDER BY, would do so nondeterministically.
 */
async function selectAllUserIds(): Promise<string[]> {
  const ids: string[] = []

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('transactions')
      .select('user_id')
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)

    if (error) throw new Error(`[Backfill] could not list users: ${error.message}`)

    const page = (data ?? []) as { user_id: string }[]
    ids.push(...page.map(r => r.user_id))
    if (page.length < PAGE) break
  }

  return Array.from(new Set(ids))
}

async function main() {
  console.log(`[Backfill] mode: ${APPLY ? 'APPLY (writes)' : 'DRY-RUN (no writes)'}`)
  console.log(
    FROM
      ? `[Backfill] --from ${FROM}: range floor overridden (every transaction still replays in full)`
      : "[Backfill] range floor: derived per-user from each user's first transaction"
  )
  if (ALLOW_NEGATIVE_CASH) {
    console.log('[Backfill] --allow-negative-cash: the funding-side guard is DISABLED')
  }
  if (ALLOW_PRICE_SCALE) {
    console.log('[Backfill] --allow-price-scale: non-split price-scale violations will be reported, not aborted')
  }
  if (FILL_BREAKDOWN) {
    console.log(
      '[Backfill] --fill-breakdown: filling the breakdown on EXISTING rows; totals are never rewritten; ' +
      'rows that already have a breakdown are SKIPPED by default (use --refill to override)'
    )
  }
  if (REFILL) {
    console.log(
      '[Backfill] !!! --refill: DANGER — rows that ALREADY HAVE a breakdown will be RECOMPUTED and ' +
      'OVERWRITTEN, including correct MEASURED breakdowns. This is the deliberate override, not the default. !!!'
    )
  }

  // Shared catalog, read once for the whole run.
  const tickerCatalog = await fetchTickerCatalog()
  console.log(`[Backfill] ticker_identity: ${tickerCatalog.size} confirmed symbol(s)`)

  let userIds = await selectAllUserIds()
  if (ONLY_USER) userIds = userIds.filter(id => id === ONLY_USER)

  // An empty list after filtering by --user means the UUID matched nothing —
  // that must abort, not print "0 user(s)" followed by "done" as if the run
  // succeeded.
  if (ONLY_USER && userIds.length === 0) {
    throw new Error(`[Backfill] --user ${ONLY_USER} matched no user with transactions`)
  }

  console.log(`[Backfill] ${userIds.length} user(s) with transactions`)

  for (const userId of userIds) {
    console.log(`\n───── user ${userId} ─────`)

    const transactions = await selectAll<ReplayTransaction>(
      'transactions',
      'ticker, operation, quantity, price, commission, date, asset_type, created_at',
      userId,
      'id'
    )
    const movements = await selectAll<ReplayMovement>('cash_movements', 'type, amount, date', userId, 'id')

    if (transactions.length === 0) {
      console.log('  skipped: no transactions')
      continue
    }

    // ── Gate: does replaying today reproduce what the app stores today? ──
    const today = new Date().toISOString().slice(0, 10)
    const replayedToday = replayPortfolioAt(transactions, movements, today)

    const storedPositions = await selectAll<any>('positions', 'ticker, quantity, total_invested', userId, 'id')
    const storedONs = await selectAll<any>('on_positions', 'ticker, quantity, total_invested', userId, 'id')
    const storedCash = await selectAll<any>('cash_balance', 'balance', userId, 'id')

    const gate = reconcileUser(replayedToday, {
      positions: storedPositions,
      onPositions: storedONs,
      cashBalance: Number(storedCash[0]?.balance ?? 0),
    })

    if (!gate.ok) {
      console.log(`  SKIPPED — replay does not reproduce stored state (${gate.reasons.length} reason(s)):`)
      gate.reasons.forEach(r => console.log(`    · ${r}`))
      continue
    }
    console.log('  gate: PASS (replay reproduces stored state)')

    // ── Prices: one call per ticker, for the whole range. Aborts on failure. ──
    const firstTransactionDate = transactions
      .map(t => String(t.date).slice(0, 10))
      .sort()[0]
    // --from overrides the LOWER bound of the RECONSTRUCTED range only (the
    // bar-fetch window below and marketDaysFrom's `from`). It must NEVER
    // narrow `transactions` itself — that array feeds replayPortfolioAt for
    // every day below, unfiltered, or a position bought before this date
    // would vanish from every row in the reconstructed range.
    const rangeStart = FROM ?? firstTransactionDate
    // Normalized once here: 'aapl' and 'AAPL' must be one Yahoo call and one map
    // key, not two — buildBackfillRows indexes barsByTicker by normalized key
    // too, and is last-wins on collision, so an unnormalized key here could
    // silently drop bars fetched under a differently-cased variant.
    const stockTxsByTicker = new Map<string, ReplayTransaction[]>()
    for (const tx of transactions) {
      if (String(tx.asset_type ?? '').toUpperCase() === 'ON') continue
      const ticker = String(tx.ticker).trim().toUpperCase()
      const rows = stockTxsByTicker.get(ticker) ?? []
      rows.push(tx)
      stockTxsByTicker.set(ticker, rows)
    }
    const tickers = Array.from(stockTxsByTicker.keys())

    const rangeNote = rangeStart === firstTransactionDate ? '' : ` (first transaction ${firstTransactionDate})`
    console.log(`  history from ${rangeStart}${rangeNote}, ${tickers.length} stock ticker(s)`)

    const barsByTicker = new Map<string, DailyBar[]>()
    const priceScaleViolations: PriceScaleViolation[] = []
    for (const ticker of tickers) {
      // WHAT to ask Yahoo for: the human-confirmed symbol when the catalog has
      // one, else the exchange-normalized string ('BCBA:GGAL' → 'GGAL.BA').
      // Asking with the raw ticker is how a string gets priced as whatever
      // instrument happens to match it.
      const symbol = tickerCatalog.get(ticker) ?? normalizeTickerForYahoo(ticker)
      if (symbol !== ticker) console.log(`    · ${ticker} → Yahoo symbol ${symbol}`)

      const bars = await fetchDailyBars(symbol, new Date(rangeStart), new Date())

      // The map is keyed by the PORTFOLIO ticker, not the Yahoo symbol —
      // buildBackfillRows looks positions up by their own ticker.
      barsByTicker.set(ticker, bars)

      if (bars.length === 0) console.log(`    · ${ticker}: NO BARS — will be marked at cost`)
      else if (userId === TEST_USER) console.log(`    · ${ticker}: skipping price-scale check (known test account)`)
      else priceScaleViolations.push(...findPriceScaleViolations(ticker, symbol, bars, stockTxsByTicker.get(ticker) ?? []))

      await sleep(FETCH_DELAY_MS)
    }

    // Decide once, after the whole ticker scan completes, instead of
    // aborting on the first violation hit mid-scan.
    reportAndGatePriceScaleViolations(priceScaleViolations)

    // ── Days ──
    const existing = await selectAll<{
      snapshot_date: string
      source: string | null
      stocks_value: number | null
      total_value: number
      total_invested: number
      pnl: number
      pnl_pct: number
    }>(
      'portfolio_snapshots',
      'snapshot_date, source, total_value, total_invested, pnl, pnl_pct, stocks_value',
      userId,
      'snapshot_date'
    )
    const taken = new Set(existing.map(r => String(r.snapshot_date).slice(0, 10)))
    const allDays = marketDaysFrom(barsByTicker, rangeStart, new Date().toISOString().slice(0, 10))

    // Normal mode writes the days that have NO row. Fill mode does the exact
    // opposite: it revisits the days that DO have one, to complete them.
    const dates = FILL_BREAKDOWN
      ? allDays.filter(d => taken.has(d))
      : allDays.filter(d => !taken.has(d))

    console.log(
      FILL_BREAKDOWN
        ? `  ${taken.size} row(s) already recorded, ${allDays.length} market day(s) in range → ${dates.length} to fill`
        : `  ${allDays.length} market day(s) in range, ${taken.size} already recorded → ${dates.length} to write`
    )
    if (FILL_BREAKDOWN && dates.length < taken.size) {
      console.log(
        `  NOTE: ${taken.size - dates.length} recorded row(s) fall outside the market calendar ` +
        `derived from Yahoo bars and will NOT be filled — their breakdown stays null`
      )
    }
    if (dates.length === 0) continue

    const days = buildBackfillRows({
      userId,
      transactions,
      movements,
      dates,
      barsByTicker,
      allowNegativeCash: ALLOW_NEGATIVE_CASH,
    })

    // unpricedTickers includes every ON position UNCONDITIONALLY (buildBackfillRows
    // has no historical source for them, spot-only Data912) — so a single count of
    // "days with something marked at cost" is saturated by ON holdings and tells
    // the maintainer nothing about whether the STOCKS priced well. Split them.
    const onTickers = new Set(
      transactions
        .filter(t => String(t.asset_type ?? '').toUpperCase() === 'ON')
        .map(t => String(t.ticker).trim().toUpperCase())
    )

    // The denominator is the days that ticker was HELD, not the length of the
    // backfill. A ticker held 50 of 1120 days and unpriced on all 50 is a 100%
    // pricing failure for that position's whole life; "50 of 1120" reads as 4%.
    // Few tickers are held the full range, so the wrong denominator understates
    // severity on nearly every line of the report this decision is made from.
    const unpricedStockDays = new Map<string, number>()
    const heldStockDays = new Map<string, number>()
    for (const day of days) {
      for (const ticker of day.heldTickers) {
        if (onTickers.has(ticker)) continue
        heldStockDays.set(ticker, (heldStockDays.get(ticker) ?? 0) + 1)
      }
      for (const ticker of day.unpricedTickers) {
        if (onTickers.has(ticker)) continue
        unpricedStockDays.set(ticker, (unpricedStockDays.get(ticker) ?? 0) + 1)
      }
    }

    if (unpricedStockDays.size === 0) {
      console.log('  every stock position priced from bars on every day')
    } else {
      console.log('  STOCK positions marked at cost (ticker: unpriced days of days held):')
      Array.from(unpricedStockDays.entries())
        .map(([ticker, n]) => {
          // Every unpriced day is by construction a held day, so held >= n > 0.
          const held = heldStockDays.get(ticker) ?? n
          return { ticker, n, held, share: n / held }
        })
        // Sorted by SHARE: that is the severity. A ticker unpriced on all 12 of
        // the 12 days it was held outranks one unpriced on 200 of 1100.
        .sort((a, b) => b.share - a.share || b.n - a.n)
        .forEach(({ ticker, n, held, share }) =>
          console.log(`    · ${ticker}: ${n} of ${held} days held (${(share * 100).toFixed(0)}%)`)
        )
    }
    console.log(`  ONs are always marked at cost by design (${onTickers.size} ON ticker(s))`)
    if (FILL_BREAKDOWN) {
      // In fill mode `days` holds RECOMPUTED rows, used only for their
      // breakdown parts. For a measured row the recomputed total_value is NOT
      // what is stored (that is the whole reason the ON leg is derived by
      // difference below) — printing it under "first/last value" reads as
      // confirmation that stored totals are intact, which it is not.
      console.log(
        `  recomputed range: ${days[0].row.snapshot_date} … ${days[days.length - 1].row.snapshot_date} ` +
        '(RECOMPUTED total_value, not what is stored — fill mode reads breakdown parts only)'
      )
    } else {
      console.log(`  first: ${days[0].row.snapshot_date} value ${days[0].row.total_value.toFixed(2)}`)
      console.log(`  last:  ${days[days.length - 1].row.snapshot_date} value ${days[days.length - 1].row.total_value.toFixed(2)}`)
    }

    if (FILL_BREAKDOWN) {
      const storedByDate = new Map(existing.map(r => [String(r.snapshot_date).slice(0, 10), r]))
      const updates: Array<{ date: string; breakdown: Breakdown }> = []
      const skipped: string[] = []
      const measuredFillLog: string[] = []
      let alreadyFilled = 0

      for (const day of days) {
        const date = day.row.snapshot_date
        const stored = storedByDate.get(date)
        if (!stored) continue

        // C1: the guard's own ingredient. stocks_value is already fetched in
        // the `existing` select above — this is the first place it is READ.
        // A row whose breakdown is already non-null was filled by an earlier
        // run (measured or reconstructed); recomputing it here would degrade
        // a correct MEASURED breakdown to a derived one, silently, and the
        // run would not even be idempotent — each pass would degrade a little
        // more. --refill is the deliberate, opt-in override.
        const hasBreakdown = stored.stocks_value !== null && stored.stocks_value !== undefined
        if (hasBreakdown && !REFILL) {
          alreadyFilled++
          continue
        }

        const storedTotals = {
          total_value: Number(stored.total_value),
          total_invested: Number(stored.total_invested),
          pnl: Number(stored.pnl),
          pnl_pct: Number(stored.pnl_pct),
        }

        if (String(stored.source ?? 'live') === 'estimated') {
          // A reconstructed row: the replay must reproduce it exactly before
          // its breakdown is trusted. Same inputs, same outputs — a mismatch
          // means the replay is no longer the one that produced this row.
          //
          // This ABORTS rather than skips (unlike the measured branch below).
          // Per spec 2026-07-29-per-asset-class-series-design.md:135, that
          // equality IS the verification that the re-run is sound — if the
          // replay no longer reproduces history it wrote itself, something
          // changed in the data or the engine, which invalidates confidence
          // in the other reconstructed rows too. It is not a problem with
          // this one row.
          const match = matchesStoredTotals(
            {
              total_value: day.row.total_value,
              total_invested: day.row.total_invested,
              pnl: day.row.pnl,
              pnl_pct: day.row.pnl_pct,
            },
            storedTotals
          )
          if (!match.ok) {
            throw new Error(
              `[Backfill] reconstructed row on ${date} does not reproduce its own stored totals ` +
              `(${match.reasons.join('; ')}) — aborting rather than skipping: the replay is no longer ` +
              'the one that produced this row, which puts every other reconstructed row in question too.'
            )
          }
          updates.push({
            date,
            breakdown: {
              stocks_value: day.row.stocks_value,
              stocks_invested: day.row.stocks_invested,
              ons_value: day.row.ons_value,
              ons_invested: day.row.ons_invested,
              cash_value: day.row.cash_value,
            },
          })
        } else {
          // A measured row: its total came from quotes that no longer exist and
          // must be preserved. Cash and stocks are recomputed; the ON leg is
          // derived by difference, bounded by the guard. A guard failure here
          // SKIPS (leaves the row null) — there is no "disagrees with itself"
          // signal to justify an abort the way there is above.
          const derived = deriveMeasuredBreakdown({
            stored: storedTotals,
            stocksValue: day.row.stocks_value,
            stocksInvested: day.row.stocks_invested,
            cashValue: day.row.cash_value,
            onsInvested: day.row.ons_invested,
          })
          if (!derived.ok) {
            skipped.push(`${date}: ${derived.reason}`)
            continue
          }
          updates.push({ date, breakdown: derived.breakdown })

          // I4: ons_value is the one number in this whole run that is DERIVED,
          // not sourced — surface it so the dry-run gate can actually check it
          // against the operator's own knowledge of the portfolio, the same
          // way the shortfall count was surfaced in 041ed15.
          const b = derived.breakdown
          const impliedPnlPct = b.ons_invested > 0 ? ((b.ons_value - b.ons_invested) / b.ons_invested) * 100 : 0
          const sign = impliedPnlPct >= 0 ? '+' : ''
          measuredFillLog.push(
            `${date}: ons_value ${b.ons_value.toFixed(2)}, ons_invested ${b.ons_invested.toFixed(2)} ` +
            `(implied P&L ${sign}${impliedPnlPct.toFixed(1)}%)`
          )
        }
      }

      console.log(
        `  breakdown: ${updates.length} row(s) fillable, ${skipped.length} skipped, ` +
        `${alreadyFilled} already filled (skipped)`
      )
      skipped.slice(0, 20).forEach(s => console.log(`    · SKIP ${s}`))
      if (skipped.length > 20) console.log(`    · … and ${skipped.length - 20} more`)

      if (measuredFillLog.length > 0) {
        console.log('  measured rows — derived ons_value/ons_invested (the inferred numbers in this run):')
        measuredFillLog.slice(0, 20).forEach(s => console.log(`    · ${s}`))
        if (measuredFillLog.length > 20) console.log(`    · … and ${measuredFillLog.length - 20} more`)
      }

      if (!APPLY) {
        console.log('  DRY-RUN — nothing written')
        continue
      }

      let filled = 0
      for (const u of updates) {
        // Column-scoped UPDATE: the four totals are never named here, so no
        // code path in this mode can rewrite a stored total.
        const { data, error } = await supabase
          .from('portfolio_snapshots')
          .update(u.breakdown)
          .eq('user_id', userId)
          .eq('snapshot_date', u.date)
          .select('snapshot_date')
        if (error) throw new Error(`[Backfill] breakdown update failed on ${u.date}: ${error.message}`)
        if (!data || data.length !== 1) {
          throw new Error(
            `[Backfill] breakdown update on ${u.date} affected ${data?.length ?? 0} row(s), expected exactly 1 ` +
            '— a zero-row match must not count as success'
          )
        }
        filled++
        if (filled % 25 === 0) console.log(`  filled ${filled}/${updates.length}`)
      }
      console.log(`  filled ${filled}/${updates.length}`)
      continue
    }

    if (!APPLY) {
      console.log('  DRY-RUN — nothing written')
      continue
    }

    // Insert only. An existing row is never overwritten: measured beats estimated.
    const CHUNK = 500
    let written = 0
    for (let i = 0; i < days.length; i += CHUNK) {
      const chunk = days.slice(i, i + CHUNK).map(d => d.row)
      const { error } = await supabase.from('portfolio_snapshots').insert(chunk)
      if (error) throw new Error(`[Backfill] insert failed at row ${i}: ${error.message}`)
      written += chunk.length
      console.log(`  written ${written}/${days.length}`)
    }
  }

  console.log('\n[Backfill] done')
}

main().catch(err => {
  console.error('\n[Backfill] ABORTED:', err instanceof Error ? err.message : err)
  process.exit(1)
})
