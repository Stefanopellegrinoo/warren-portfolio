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
 * that purchase is a flow. `total` (stocks + ONs + cash, the default since S9 of
 * odd/tasks/nucleo-ledger.md) contains every class, so only deposits and
 * withdrawals cross it. Income is the mirror of a trade: it LEAVES the class
 * that paid it.
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
import { computeTwrSeries, type TwrSeries } from './twr-series'

export type Universe = 'total' | 'stocks' | 'ons'

export const UNIVERSES: readonly Universe[] = ['total', 'stocks', 'ons']

export function isUniverse(value: string): value is Universe {
  return (UNIVERSES as readonly string[]).includes(value)
}

/** The `universe` query parameter of the history and statistics routes: absent
 *  is the whole portfolio, and the retired `measurable` (stocks + cash) is read
 *  as the whole portfolio too, so an old client or a cached URL keeps working.
 *  Anything else is null — the caller answers 400. */
export function parseUniverse(raw: string | null): Universe | null {
  if (raw === null || raw === 'measurable') return 'total'
  return isUniverse(raw) ? raw : null
}

export interface ProjectableSnapshot {
  snapshot_date: string
  total_value: number
  total_invested: number
  /** Open P&L of positions (excludes cash) — value − pnl = cost + cash. */
  pnl?: number | null
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
}

function finiteOrNull(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function projectRow(s: ProjectableSnapshot, universe: Universe): ProjectedPoint | null {
  let value: number | null
  let invested: number | null
  switch (universe) {
    // Universes whose value includes cash must count that cash as invested too,
    // or the chart's P&L (value − invested) reads idle cash as profit.
    case 'total': {
      value = finiteOrNull(s.total_value)
      // total_invested excludes cash; value − open pnl is cost + cash, and pnl
      // survives rows whose cash_value is null. A row without pnl keeps the old
      // cost-only invested rather than being dropped: the metrics need its value.
      const pnl = finiteOrNull(s.pnl)
      invested = value !== null && pnl !== null ? value - pnl : finiteOrNull(s.total_invested)
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
  return { snapshot_date: s.snapshot_date, value, invested }
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
 *  The commission is borne by the traded universe in both directions.
 *  Returns null for rows this function refuses to
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
  // now reachable here, and interpreting it would declare the payment twice.
  return null
}

/** Sibling routers normalize before comparing (`scripts/backfill-snapshots.ts`,
 *  migrations 019/031 apply UPPER without TRIM); an unrecognised type would
 *  silently drop the trade's flow from its class universe. */
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
 *  `ons`, where exclusion means "drop this flow" — fail closed.
 *
 *  Income leaves the class that paid it, by the same boundary logic as
 *  trades — with ONE exception. A DIVIDENDO leaves `stocks` (`−amount`); both
 *  income types are internal to `total`. The exception is the `ons` leg of a CUPON: it is NOT
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

/** The exact (points, flows, options) triple behind every flow-adjusted return
 *  of a universe — shared so the TWR curve and the risk metrics cannot drift. */
function universeReturnInputs(
  snapshots: ProjectableSnapshot[],
  universe: Universe,
  inputs: UniverseFlowInputs
) {
  const points = projectSeries(snapshots, universe)
  const flows = universeFlows(universe, inputs)
  // In `ons` a coupon day is not measured at all — see universeFlows. Only
  // this universe: `total` holds the cash the payment lands in, so there the
  // two legs cancel and every interval stays measured.
  const options =
    universe === 'ons' ? { unmeasurableDates: couponDates(inputs.income) } : {}
  return { points, flows, options }
}

/** Cumulative time-weighted return curve of a universe (same inputs as the metrics). */
export function computeUniverseTwr(
  snapshots: ProjectableSnapshot[],
  universe: Universe,
  inputs: UniverseFlowInputs
): TwrSeries {
  const { points, flows, options } = universeReturnInputs(snapshots, universe, inputs)
  return computeTwrSeries(points, flows, options)
}

export function computeUniverseRiskMetrics(
  snapshots: ProjectableSnapshot[],
  universe: Universe,
  inputs: UniverseFlowInputs
): UniverseRiskMetrics {
  const { points, flows, options } = universeReturnInputs(snapshots, universe, inputs)

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
    pointsDropped: snapshots.length - points.length,
  }
}
