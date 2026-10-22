/**
 * The portfolio in pesos, dólar MEP and dólar cable. Pure: ledger rows, engine
 * positions, peso-line prices and FX in; three amounts per figure out. Rules:
 * "Stage C decisions" in odd/tasks/multimoneda.md.
 *
 * - Cost: each lot in pesos from its trade record and the FX of its trade date,
 *   then in MEP / cable with that same FX. One moving weighted average per
 *   currency: a sale leaves it unchanged, a full close resets it.
 * - Realized: sale proceeds, dividends and coupons with the FX of their date.
 * - Value today in pesos: CEDEARs and local shares by their peso-line price, ONs
 *   by their MEP value × today's MEP, anything else by the engine USD-CCL value
 *   × today's CCL (estimated). MEP and cable are that ÷ today's rate.
 * - Cash has no currency in the ledger: it stays in the engine unit (USD-CCL).
 *
 * WORKER-SAFE: no value imports outside this folder (runs under tsx).
 */
import type { Quote } from '@/types'
import type { FxLookup } from './trade-record-backfill'

export type Currency = 'ARS' | 'MEP' | 'CCL'
export interface Amounts { ARS: number; MEP: number; CCL: number }
/** ARS per USD. */
export interface Fx { mep: number; ccl: number }

/** The `transactions` columns this module reads. */
export interface LedgerTrade {
  ticker: string
  date: string
  created_at?: string
  operation: string
  asset_type: string
  quantity: number
  price: number
  commission: number | null
  trade_currency: Currency | null
  trade_quantity: number | null
  trade_price: number | null
  trade_commission: number | null
  fx_mep: number | null
  fx_ccl: number | null
}

export interface TickerLedger {
  /** Engine units: underlying shares, or the ON ledger convention (VN / 100). */
  quantity: number
  /** Cost basis of the open quantity. */
  cost: Amounts
  /** Result of the sales. */
  realized: Amounts
  /** Dividends and coupons. */
  income: Amounts
  /** Some lot had no FX for its date and was converted with today's. */
  costEstimated: boolean
}

export type ValueSource = 'local' | 'mep' | 'estimated'

export interface PositionView {
  value: Amounts | null
  cost: Amounts
  avgCost: Amounts
  pnl: Amounts | null
  pnlPct: Amounts | null
  /** Value per engine unit. */
  price: Amounts | null
  dayChange: Amounts | null
  /** Fraction, from the line the value comes from. */
  dayChangePct: number | null
  source: ValueSource | null
  estimated: boolean
  costEstimated: boolean
}

export interface CurrencyViews {
  version: 1
  fx: { mep: number; ccl: number; mepDate: string; cclDate: string }
  positions: Record<string, PositionView>
  totals: {
    value: Amounts
    stocks: Amounts
    ons: Amounts
    cash: Amounts
    invested: Amounts
    openPnl: Amounts
    openPnlPct: Amounts
    realized: Amounts
    dayChange: Amounts
    dayChangePct: Amounts
  }
  /** Some position is valued with the estimated fallback. */
  estimated: boolean
}

/** A position as the engine enriched it (Position / ONPosition). */
export interface EnginePosition {
  ticker: string
  quantity: number
  market_value?: number
  day_change_pct?: number
}

const ZERO: Amounts = { ARS: 0, MEP: 0, CCL: 0 }
const CLOSED_QTY = 0.0001 // same threshold as the engine (rebuildClosedTrades)
const LOCAL_PREFIX = 'BCBA:'

const inCurrencies = (ars: number, fx: Fx): Amounts => ({ ARS: ars, MEP: ars / fx.mep, CCL: ars / fx.ccl })
const add = (a: Amounts, b: Amounts): Amounts => ({ ARS: a.ARS + b.ARS, MEP: a.MEP + b.MEP, CCL: a.CCL + b.CCL })
const sub = (a: Amounts, b: Amounts): Amounts => ({ ARS: a.ARS - b.ARS, MEP: a.MEP - b.MEP, CCL: a.CCL - b.CCL })
const scale = (a: Amounts, k: number): Amounts => ({ ARS: a.ARS * k, MEP: a.MEP * k, CCL: a.CCL * k })
const ratio = (a: Amounts, b: Amounts): Amounts => ({
  ARS: b.ARS ? a.ARS / b.ARS : 0, MEP: b.MEP ? a.MEP / b.MEP : 0, CCL: b.CCL ? a.CCL / b.CCL : 0,
})

/** Peso-line symbol on BYMA of a held ticker: `BCBA:GGAL` → GGAL; a CEDEAR is its own ticker. */
export function localSymbol(ticker: string): string {
  const t = ticker.trim().toUpperCase()
  return t.startsWith(LOCAL_PREFIX) ? t.slice(LOCAL_PREFIX.length) : t
}

/**
 * Pesos of one row: gross (quantity × price) and commission, and the FX that
 * converts them. A row with no trade record (loaded after 044 without a ticket)
 * follows the backfill rule: an ON was typed in MEP, anything else is USD-CCL.
 */
function rowInPesos(t: LedgerTrade, fxAt: FxLookup, today: Fx) {
  const mep = t.fx_mep ?? fxAt(t.date, 'mep')?.rate ?? null
  const ccl = t.fx_ccl ?? fxAt(t.date, 'ccl')?.rate ?? null
  const fx: Fx = { mep: mep ?? today.mep, ccl: ccl ?? today.ccl }
  const hasTicket = t.trade_quantity != null && t.trade_price != null
  const currency: Currency =
    t.trade_currency && (hasTicket || t.trade_currency === 'CCL') ? t.trade_currency : t.asset_type === 'ON' ? 'MEP' : 'CCL'

  let gross: number, commission: number
  if (currency === 'CCL' || !hasTicket) {
    // Engine values: USD-CCL for shares and CEDEARs, USD-MEP for an ON without a ticket.
    const rate = currency === 'MEP' ? fx.mep : fx.ccl
    gross = t.price * Math.abs(t.quantity) * rate
    commission = (t.commission ?? 0) * rate
  } else {
    const rate = currency === 'MEP' ? fx.mep : 1
    gross = t.trade_price! * t.trade_quantity! * rate
    commission = (t.trade_commission ?? 0) * rate
  }
  // Even a peso trade needs both rates of its date to be shown in MEP and cable.
  return { gross, commission, fx, estimated: mep === null || ccl === null }
}

const byTradeOrder = (a: LedgerTrade, b: LedgerTrade) =>
  a.date.localeCompare(b.date) || (a.created_at ?? '').localeCompare(b.created_at ?? '')

/** Replays every row, per ticker, in trade order. */
export function replayLedger(trades: LedgerTrade[], fxAt: FxLookup, today: Fx): Map<string, TickerLedger> {
  const out = new Map<string, TickerLedger>()
  for (const t of [...trades].sort(byTradeOrder)) {
    const s = out.get(t.ticker) ?? { quantity: 0, cost: ZERO, realized: ZERO, income: ZERO, costEstimated: false }
    const { gross, commission, fx, estimated } = rowInPesos(t, fxAt, today)
    const qty = Math.abs(t.quantity)

    if (t.operation === 'COMPRA') {
      s.cost = add(s.cost, inCurrencies(gross + commission, fx))
      s.quantity += qty
      s.costEstimated ||= estimated
    } else if (t.operation === 'VENTA' && s.quantity > 0 && qty > 0) {
      const sold = Math.min(qty, s.quantity)
      const released = scale(s.cost, sold / s.quantity)
      const proceeds = inCurrencies(gross * (sold / qty) - commission, fx)
      s.realized = add(s.realized, sub(proceeds, released))
      s.cost = sub(s.cost, released)
      s.quantity -= sold
      s.costEstimated ||= estimated
      if (s.quantity <= CLOSED_QTY) { s.quantity = 0; s.cost = ZERO; s.costEstimated = false }
    } else if (t.operation === 'DIVIDENDO' || t.operation === 'CUPON') {
      s.income = add(s.income, inCurrencies(gross, fx))
    }
    out.set(t.ticker, s)
  }
  return out
}

/** Value today of one position in the three currencies. */
export function valuePosition(
  p: EnginePosition & { kind: 'stock' | 'on' },
  ctx: { ratios: ReadonlyMap<string, number>; local: ReadonlyMap<string, Quote>; fx: Fx }
): { value: Amounts | null; dayChangePct: number | null; source: ValueSource | null; estimated: boolean } {
  const usd = typeof p.market_value === 'number' && isFinite(p.market_value) ? p.market_value : null
  const usdPct = typeof p.day_change_pct === 'number' && isFinite(p.day_change_pct) ? p.day_change_pct : null

  if (p.kind === 'on') {
    if (usd === null) return { value: null, dayChangePct: null, source: null, estimated: false }
    return { value: inCurrencies(usd * ctx.fx.mep, ctx.fx), dayChangePct: usdPct, source: 'mep', estimated: false }
  }

  const symbol = localSymbol(p.ticker)
  const isLocalShare = p.ticker.trim().toUpperCase().startsWith(LOCAL_PREFIX)
  const perUnit = isLocalShare ? 1 : ctx.ratios.get(p.ticker)
  const local = ctx.local.get(symbol)
  if (perUnit && local && local.price > 0) {
    return { value: inCurrencies(p.quantity * perUnit * local.price, ctx.fx), dayChangePct: local.changePercent, source: 'local', estimated: false }
  }
  if (usd === null) return { value: null, dayChangePct: null, source: null, estimated: false }
  return { value: inCurrencies(usd * ctx.fx.ccl, ctx.fx), dayChangePct: usdPct, source: 'estimated', estimated: true }
}

export function buildCurrencyViews(input: {
  positions: EnginePosition[]
  onPositions: EnginePosition[]
  trades: LedgerTrade[]
  cashBalance: number
  ratios: ReadonlyMap<string, number>
  local: ReadonlyMap<string, Quote>
  fx: { mep: { rate: number; date: string }; ccl: { rate: number; date: string } }
  fxAt: FxLookup
}): CurrencyViews {
  const fx: Fx = { mep: input.fx.mep.rate, ccl: input.fx.ccl.rate }
  const ledger = replayLedger(input.trades, input.fxAt, fx)
  const cash = { ARS: input.cashBalance * fx.ccl, MEP: (input.cashBalance * fx.ccl) / fx.mep, CCL: input.cashBalance }

  const positions: Record<string, PositionView> = {}
  let stocks = ZERO, ons = ZERO, invested = ZERO, dayChange = ZERO
  let estimated = false

  const held = [
    ...input.positions.map(p => ({ ...p, kind: 'stock' as const })),
    ...input.onPositions.map(p => ({ ...p, kind: 'on' as const })),
  ]
  for (const p of held) {
    const l = ledger.get(p.ticker)
    const cost = l?.cost ?? ZERO
    const qtyMismatch = !l || Math.abs(l.quantity - p.quantity) > CLOSED_QTY
    const v = valuePosition(p, { ratios: input.ratios, local: input.local, fx })
    const pct = v.dayChangePct
    const day = v.value && pct !== null && pct > -1 ? scale(v.value, pct / (1 + pct)) : null
    const pnl = v.value ? sub(v.value, cost) : null

    positions[p.ticker] = {
      value: v.value,
      cost,
      avgCost: p.quantity > 0 ? scale(cost, 1 / p.quantity) : ZERO,
      pnl,
      pnlPct: pnl ? ratio(pnl, cost) : null,
      price: v.value && p.quantity > 0 ? scale(v.value, 1 / p.quantity) : null,
      dayChange: day,
      dayChangePct: v.value ? pct : null,
      source: v.source,
      estimated: v.estimated,
      costEstimated: (l?.costEstimated ?? false) || qtyMismatch,
    }

    if (!v.value) continue // unpriced: out of the totals, as the engine's 'drop' policy does
    if (p.kind === 'on') ons = add(ons, v.value)
    else stocks = add(stocks, v.value)
    invested = add(invested, cost)
    if (day) dayChange = add(dayChange, day)
    estimated ||= v.estimated
  }

  let realized = ZERO
  ledger.forEach(l => { realized = add(realized, add(l.realized, l.income)) })

  const openPnl = sub(add(stocks, ons), invested)
  return {
    version: 1,
    fx: { mep: fx.mep, ccl: fx.ccl, mepDate: input.fx.mep.date, cclDate: input.fx.ccl.date },
    positions,
    totals: {
      value: add(add(stocks, ons), cash),
      stocks,
      ons,
      cash,
      invested,
      openPnl,
      openPnlPct: ratio(openPnl, invested),
      realized,
      dayChange,
      dayChangePct: ratio(dayChange, invested),
    },
    estimated,
  }
}
