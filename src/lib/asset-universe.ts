/**
 * Projections of the snapshot series onto asset universes, and the flows
 * that cross each universe's boundary.
 *
 * Why: the risk figures on /statistics were computed over the whole-portfolio
 * snapshot series regardless of which tab displayed them. Migration 034
 * persisted a per-asset-class breakdown; this module is the single place that
 * turns it into per-universe series, flows and threshold-gated metrics.
 * Design: docs/superpowers/specs/2026-07-29-per-asset-class-series-design.md
 *
 * The subtle rule (spec A1 plus its two corrections): each universe uses the
 * flows that cross ITS OWN boundary. Buying stock with cash is +10,000 of
 * stocks_value in a stocks-only series — a "gain" that isn't — so for `stocks`
 * that purchase is a flow. For `measurable` (stocks + cash) a STOCK purchase
 * is internal, but an ON purchase is NOT — ONs are outside it — and neither
 * is an ON COUPON, which arrives as cash from an asset the universe does not
 * contain. Income is the mirror of a trade: it LEAVES the class that paid it.
 *
 * A row missing a field its universe needs is DROPPED, never coerced to 0:
 * null means "not known", zero would assert "this class was worth nothing".
 *
 * WORKER-SAFE: imports only sibling pure modules.
 */
import type { SnapshotPoint, ExternalFlow } from './drawdown'
import {
  computeFlowAdjustedMaxDrawdown,
  computeFlowAdjustedReturns,
} from './drawdown'
import { computeReturnStats } from './return-stats'

export type Universe = 'total' | 'measurable' | 'stocks' | 'ons'

export const UNIVERSES: readonly Universe[] = ['total', 'measurable', 'stocks', 'ons']

export function isUniverse(value: string): value is Universe {
  return (UNIVERSES as readonly string[]).includes(value)
}

export interface ProjectableSnapshot {
  snapshot_date: string
  total_value: number
  total_invested: number
  source?: 'live' | 'estimated'
  stocks_value?: number | null
  stocks_invested?: number | null
  ons_value?: number | null
  ons_invested?: number | null
  cash_value?: number | null
}

export interface ProjectedPoint {
  snapshot_date: string
  value: number
  invested: number
  source?: 'live' | 'estimated'
}

function finiteOrNull(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function projectRow(s: ProjectableSnapshot, universe: Universe): ProjectedPoint | null {
  let value: number | null
  let invested: number | null
  switch (universe) {
    case 'total':
      value = finiteOrNull(s.total_value)
      invested = finiteOrNull(s.total_invested)
      break
    case 'measurable': {
      const stocks = finiteOrNull(s.stocks_value)
      const cash = finiteOrNull(s.cash_value)
      value = stocks !== null && cash !== null ? stocks + cash : null
      invested = finiteOrNull(s.stocks_invested)
      break
    }
    case 'stocks':
      value = finiteOrNull(s.stocks_value)
      invested = finiteOrNull(s.stocks_invested)
      break
    case 'ons':
      value = finiteOrNull(s.ons_value)
      invested = finiteOrNull(s.ons_invested)
      break
    default:
      // Unreachable while both routes gate on isUniverse — but a cast that
      // slipped past would otherwise leave value/invested UNASSIGNED, and
      // `undefined === null` is false, so a {value: undefined} point would
      // escape the guard below and reach the metrics as NaN.
      return null
  }
  if (value === null || invested === null) return null
  const point: ProjectedPoint = { snapshot_date: s.snapshot_date, value, invested }
  if (s.source) point.source = s.source
  return point
}

/** Projects a snapshot series onto one universe's value for the CHART.
 *  Rows lacking what the universe needs are DROPPED, never coerced to 0. */
export function projectHistory(
  snapshots: ProjectableSnapshot[],
  universe: Universe
): ProjectedPoint[] {
  const out: ProjectedPoint[] = []
  for (const s of snapshots) {
    const p = projectRow(s, universe)
    if (p) out.push(p)
  }
  return out
}

/** Same projection shaped for the metrics pipeline (drawdown / return stats). */
export function projectSeries(
  snapshots: ProjectableSnapshot[],
  universe: Universe
): SnapshotPoint[] {
  return projectHistory(snapshots, universe).map((p) => ({
    snapshot_date: p.snapshot_date,
    total_value: p.value,
  }))
}

export interface FlowTransaction {
  date: string
  operation: string
  quantity: number
  price: number
  commission: number | null
  asset_type: string | null
}

/** Income paid BY an asset class INTO cash. `type` names the paying class:
 *  CUPON comes from ONs, DIVIDENDO from stocks (cash-engine.ts:26-27).
 *  `amount` is unsigned, as stored — direction comes from the universe. */
export interface IncomeMovement {
  date: string
  type: 'CUPON' | 'DIVIDENDO'
  amount: number
}

export interface UniverseFlowInputs {
  externalFlows: ExternalFlow[]
  transactions: FlowTransaction[]
  income: IncomeMovement[]
}

const STOCK_ASSET_TYPES = new Set(['ACCION', 'CEDEAR'])

/** COMPRA moves cost INTO the traded universe; VENTA moves proceeds OUT.
 *  The commission is borne by the traded universe in both directions —
 *  the same way `measurable` sees a buy (internal, so only the commission
 *  changes its value). Returns null for rows this function refuses to
 *  interpret: fail closed, never guess. */
function tradeFlowAmount(t: FlowTransaction): number | null {
  const commission = t.commission ?? 0
  if (
    !Number.isFinite(t.quantity) ||
    !Number.isFinite(t.price) ||
    !Number.isFinite(commission)
  ) {
    return null
  }
  // The DB stores VENTA quantity NEGATIVE (positive=buy, negative=sell).
  // The OPERATION determines direction; the magnitude is always |quantity| —
  // the same defensive idiom the portfolio engine uses.
  const gross = Math.abs(t.quantity) * t.price
  if (t.operation === 'COMPRA') return gross + commission
  if (t.operation === 'VENTA') return -(gross - commission)
  // DIVIDENDO, CUPON and anything else do not cross the value boundary as a
  // TRADE — income has its own boundary logic in netIncome/universeFlows,
  // fed from cash_movements. This refusal is load-bearing since migration 035
  // widened the `transactions.operation` CHECK to admit CUPON: a CUPON row is
  // now reachable here, and if this function ever interpreted it, `measurable`
  // would net the trade flow against the income flow to exactly zero — silently
  // reinstating the fabricated gain this branch exists to remove. Mutation-
  // verified 2026-07-30: making this return `gross` for CUPON left all 860
  // pre-existing tests green; the test below is the one that catches it.
  return null
}

/** Sibling routers normalize before comparing (`scripts/backfill-snapshots.ts`,
 *  migrations 019/031 apply UPPER without TRIM). Doing it here matters more
 *  than it does there: for the class universes an unrecognised type merely
 *  drops a flow, but for `measurable` it silently means "internal", which
 *  reinstates the fabricated loss the ON-boundary fix removed. */
const normalizedAssetType = (t: FlowTransaction): string | null => {
  if (typeof t.asset_type !== 'string') return null
  const normalized = t.asset_type.trim().toUpperCase()
  return normalized === '' ? null : normalized
}

const isOnTrade = (t: FlowTransaction) => normalizedAssetType(t) === 'ON'
const isStockTrade = (t: FlowTransaction) => {
  const type = normalizedAssetType(t)
  return type !== null && STOCK_ASSET_TYPES.has(type)
}

/** Net one class's trade flows by date. Positive = value INTO that class. */
function netTradeFlows(
  wanted: (t: FlowTransaction) => boolean,
  transactions: FlowTransaction[],
  into: Map<string, number> = new Map(),
  sign: 1 | -1 = 1
): Map<string, number> {
  for (const t of transactions) {
    if (!wanted(t)) continue
    const amount = tradeFlowAmount(t)
    if (amount === null) continue
    into.set(t.date, (into.get(t.date) ?? 0) + sign * amount)
  }
  return into
}

/** Net one income type by date into `into`. Fails closed on a non-finite
 *  amount, the same way tradeFlowAmount refuses a row it cannot interpret. */
function netIncome(
  income: IncomeMovement[],
  type: IncomeMovement['type'],
  into: Map<string, number>,
  sign: 1 | -1
): Map<string, number> {
  for (const m of income) {
    if (m.type !== type) continue
    const amount = Math.abs(Number(m.amount))
    if (!Number.isFinite(amount)) continue
    into.set(m.date, (into.get(m.date) ?? 0) + sign * amount)
  }
  return into
}

/** The dates on which the ONs paid a coupon — the intervals the `ons`
 *  universe cannot interpret, whatever their numbers say. */
function couponDates(income: IncomeMovement[]): string[] {
  return income.filter((m) => m.type === 'CUPON').map((m) => m.date)
}

function toFlows(netByDate: Map<string, number>): ExternalFlow[] {
  return [...netByDate.entries()]
    .filter(([, amount]) => amount !== 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, amount]) => ({ date, amount }))
}

/** The flows that cross this universe's boundary (spec A1).
 *  Routing is by asset_type ONLY — never by ticker suffix (AMD, FORD and JD
 *  are stocks ending in D).
 *
 *  An unclassifiable asset_type (null, blank) is excluded from `stocks` and
 *  `ons`, where exclusion means "drop this flow" — fail closed. It CANNOT
 *  fail closed for `measurable`: there, excluding a trade is indistinguishable
 *  from declaring it internal, and if it was really an ON trade its value
 *  leaves the universe unaccounted. Nothing here can tell those apart, which
 *  is exactly why the comparison is normalized rather than raw.
 *
 *  Income leaves the class that paid it, by the same boundary logic as
 *  trades — with ONE exception. A CUPON enters `measurable`, since the ONs
 *  that paid it sit outside; a DIVIDENDO leaves `stocks` (`−amount`) but is
 *  INTERNAL to `measurable`, which contains stocks and cash both. Both are
 *  internal to `total`. The exception is the `ons` leg of a CUPON: it is NOT
 *  declared as a flow, because whether ons_value actually fell depends on how
 *  the leg was marked, which the row does not record. That day is skipped by
 *  computeUniverseRiskMetrics instead. Routed by `IncomeMovement.type`,
 *  sourced from `cash_movements` via `src/lib/cash-flows.ts` — never from
 *  `transactions`. */
export function universeFlows(
  universe: Universe,
  inputs: UniverseFlowInputs
): ExternalFlow[] {
  const { externalFlows, transactions, income } = inputs

  // Everything is inside `total`: only real deposits and withdrawals cross it,
  // and income moves value from one pocket to another within it.
  if (universe === 'total') return externalFlows

  const net = new Map<string, number>()

  if (universe === 'measurable') {
    // stocks + cash. A STOCK trade and a DIVIDENDO are both internal — each
    // moves value between two things that are inside. ONs are OUTSIDE, so an
    // ON purchase takes cash out and an ON COUPON brings cash in.
    for (const f of externalFlows) {
      net.set(f.date, (net.get(f.date) ?? 0) + (Number(f.amount) || 0))
    }
    netTradeFlows(isOnTrade, transactions, net, -1)
    netIncome(income, 'CUPON', net, 1)
    return toFlows(net)
  }

  if (universe === 'ons') {
    // NO coupon flow here, deliberately. A `−amount` would be a bet on how
    // ons_value moved: right when the leg was priced, and a fabricated gain
    // the size of the coupon when the leg fell back to cost. The row does not
    // record which happened, so computeUniverseRiskMetrics skips the interval
    // instead — correct under either convention. Ruling 2026-08-01; see
    // couponDates below and FlowAdjustedOptions in drawdown.ts.
    netTradeFlows(isOnTrade, transactions, net, 1)
    return toFlows(net)
  }

  netTradeFlows(isStockTrade, transactions, net, 1)
  netIncome(income, 'DIVIDENDO', net, -1)
  return toFlows(net)
}

/** A3 (spec): below these interval counts a metric is null, never a number.
 *  20 ≈ one trading month for the annualized pair; 2 for the drawdown,
 *  which is an extremum rather than an annualization. */
export const MIN_INTERVALS_ANNUALIZED = 20
export const MIN_INTERVALS_DRAWDOWN = 2

/** The snapshot rows whose projection feeds a universe's METRICS — the chart
 *  may legitimately show more. ONs metrics use measured rows only: an
 *  estimated ons_value is a cost mark, not a measurement, and volatility
 *  over that flat line is the fake calm this design exists to kill
 *  (user ruling 2026-07-29). */
export function metricsRows(
  snapshots: ProjectableSnapshot[],
  universe: Universe
): ProjectableSnapshot[] {
  // Canonical provenance polarity: a row with NO source counts as live
  // (migration 033: not null default 'live'; series-provenance.ts rule —
  // never invent a third state). User ruling 2026-07-30.
  return universe === 'ons'
    ? snapshots.filter((s) => s.source !== 'estimated')
    : snapshots
}

export interface UniverseRiskMetrics {
  maxDrawdown: number | null
  annualizedVol: number | null
  sharpeRatio: number | null
  returnIntervals: number
  drawdownIntervals: number
  drawdownIntervalsSkipped: number
  pointsUsed: number
  pointsDropped: number
}

export function computeUniverseRiskMetrics(
  snapshots: ProjectableSnapshot[],
  universe: Universe,
  inputs: UniverseFlowInputs
): UniverseRiskMetrics {
  const rows = metricsRows(snapshots, universe)
  const points = projectSeries(rows, universe)
  const flows = universeFlows(universe, inputs)

  // In `ons` a coupon day is not measured at all — see universeFlows. Only
  // this universe: `measurable` depends on cash_value, which genuinely rises
  // on the payment date under any mark convention, so there the flow is right
  // and every interval stays measured.
  const options =
    universe === 'ons' ? { unmeasurableDates: couponDates(inputs.income) } : {}

  const drawdown = computeFlowAdjustedMaxDrawdown(points, flows, options)
  const returnSeries = computeFlowAdjustedReturns(points, flows, options)
  const stats = computeReturnStats(returnSeries.returns)

  const annualizedOk = stats.intervals >= MIN_INTERVALS_ANNUALIZED
  return {
    maxDrawdown:
      drawdown.intervalsUsed >= MIN_INTERVALS_DRAWDOWN ? drawdown.maxDrawdown : null,
    annualizedVol: annualizedOk ? stats.annualizedVol : null,
    sharpeRatio: annualizedOk ? stats.sharpeRatio : null,
    returnIntervals: returnSeries.intervalsUsed,
    drawdownIntervals: drawdown.intervalsUsed,
    drawdownIntervalsSkipped: drawdown.intervalsSkipped,
    pointsUsed: points.length,
    pointsDropped: rows.length - points.length,
  }
}
