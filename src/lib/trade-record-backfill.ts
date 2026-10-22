import type { FxKind } from './fx-rates'
import type { FxSource, TradeCurrency } from './trade-record'

/**
 * Reconstructs the trade record (migration 044) of rows loaded before it.
 * Pure: rows, an FX lookup and the current CEDEAR ratios in, planned updates out.
 * It never plans a change to quantity, price, commission, date, ticker or
 * asset_type. Rules: "Stage B decisions" in odd/tasks/multimoneda.md.
 *
 * - ACCION rows are CEDEARs the user already converted to underlying shares in
 *   USD-CCL, so the engine values ARE the ticket in CCL. Approximate.
 * - CEDEAR rows were converted by the old form with the live FX of the day they
 *   were LOADED; undoing that conversion needs that day's FX (S5 exception).
 *   Every stored FX column is the TRADE date's.
 * - ON rows were typed in dólar MEP.
 */

export interface LedgerRow {
  id: string
  date: string
  ticker: string
  operation: string
  asset_type: string
  moneda: string | null
  quantity: number
  price: number
  commission: number
  created_at: string
}

export type FxLookup = (date: string, kind: FxKind) => { rate: number; date: string } | null

export interface TradeRecordUpdate {
  id: string
  trade_currency: TradeCurrency | null
  trade_quantity: number | null
  trade_price: number | null
  trade_commission: number | null
  cedear_ratio: number | null
  fx_mep: number | null
  fx_ccl: number | null
  fx_date: string | null
  fx_source: FxSource | null
  needs_review: boolean
  review_note: string | null
}

const MAX_LOAD_LAG_DAYS = 3
// `transactions.quantity` is numeric(18,6): a share count is off by up to half a
// unit of the 6th decimal, so a CEDEAR count (shares × ratio) by up to ratio × 5e-7.
const COUNT_TOLERANCE = 1e-6
const STORED_QUANTITY_HALF_STEP = 5e-7

/** Reference FX by date with the previous-day fallback, from fx_rates rows. */
export function fxLookupFrom(rows: { date: string; kind: FxKind; buy: number; sell: number }[]): FxLookup {
  const series: Record<FxKind, { date: string; rate: number }[]> = { mep: [], ccl: [] }
  for (const r of rows) series[r.kind].push({ date: r.date, rate: (Number(r.buy) + Number(r.sell)) / 2 })
  for (const s of Object.values(series)) s.sort((a, b) => a.date.localeCompare(b.date))
  return (date, kind) => {
    const s = series[kind]
    let lo = 0, hi = s.length - 1, found = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (s[mid].date <= date) { found = mid; lo = mid + 1 } else hi = mid - 1
    }
    return found < 0 ? null : { rate: s[found].rate, date: s[found].date }
  }
}

const dayDiff = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000)
const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

function tradeDateFx(fx: FxLookup, date: string) {
  const mep = fx(date, 'mep')
  const ccl = fx(date, 'ccl')
  return { fx_mep: mep?.rate ?? null, fx_ccl: ccl?.rate ?? null, fx_date: ccl?.date ?? mep?.date ?? null, any: !!(mep || ccl) }
}

function mirror(r: LedgerRow, fx: FxLookup, currency: TradeCurrency, source: FxSource, ratio: number | null): TradeRecordUpdate {
  const { any, ...fxCols } = tradeDateFx(fx, r.date)
  return {
    id: r.id,
    trade_currency: currency,
    trade_quantity: Math.abs(r.quantity),
    trade_price: r.price,
    trade_commission: r.commission,
    cedear_ratio: ratio,
    ...fxCols,
    fx_source: any ? source : null,
    needs_review: false,
    review_note: null,
  }
}

function planAccion(r: LedgerRow, fx: FxLookup, ratios: ReadonlyMap<string, number>): TradeRecordUpdate {
  const ratio = ratios.get(r.ticker) ?? null
  const u = mirror(r, fx, 'CCL', 'reconstructed', ratio)
  if (ratio !== null) return u
  return {
    ...u,
    needs_review: true,
    review_note: `${r.ticker} no figura como CEDEAR: se tomó el precio cargado como dólar cable. Revisá en qué moneda y a qué precio lo operaste.`,
  }
}

function planCedear(r: LedgerRow, fx: FxLookup, ratios: ReadonlyMap<string, number>): TradeRecordUpdate {
  const { any, ...fxCols } = tradeDateFx(fx, r.date)
  const empty: TradeRecordUpdate = {
    id: r.id, trade_currency: null, trade_quantity: null, trade_price: null, trade_commission: null, cedear_ratio: null,
    ...fxCols, fx_source: any ? 'reference' : null, needs_review: true, review_note: null,
  }
  const ratio = ratios.get(r.ticker)
  if (!ratio) return { ...empty, review_note: `${r.ticker} no figura en la lista de CEDEARs: no se pudo reconstruir la cantidad ni el precio originales.` }

  const loadDay = r.created_at.slice(0, 10)
  const cclLoad = fx(loadDay, 'ccl')?.rate
  const mepLoad = fx(loadDay, 'mep')?.rate
  const isArs = r.moneda === 'ARS'
  if (!cclLoad || (!isArs && !mepLoad)) {
    return { ...empty, cedear_ratio: ratio, review_note: `No hay cotización del dólar del día de carga (${ddmmyyyy(loadDay)}): no se pudo reconstruir el precio original.` }
  }

  // Old form: ARS price = precio × ratio / ccl; USD (MEP) price = precio × mep × ratio / ccl.
  // Commission: ARS was divided by ccl; USD was stored as typed.
  const tradePrice = isArs ? (r.price * cclLoad) / ratio : (r.price * cclLoad) / (mepLoad! * ratio)
  const tradeCommission = isArs ? r.commission * cclLoad : r.commission

  const rawCount = Math.abs(r.quantity) * ratio
  const tolerance = Math.max(COUNT_TOLERANCE, ratio * STORED_QUANTITY_HALF_STEP)
  const isInteger = Math.abs(rawCount - Math.round(rawCount)) <= tolerance
  const count = isInteger ? Math.round(rawCount) : rawCount

  const notes: string[] = []
  const lag = dayDiff(r.date, loadDay)
  if (lag > MAX_LOAD_LAG_DAYS) {
    notes.push(`Cargada ${lag} días después de la fecha de operación: el precio original se reconstruyó con el dólar del día de carga (${ddmmyyyy(loadDay)}), que puede no ser el que usaste.`)
  }
  if (!isInteger) {
    notes.push(`La cantidad reconstruida (${Number(rawCount.toFixed(4))} CEDEARs) no es entera: el ratio pudo haber cambiado desde la operación.`)
  }

  return {
    ...empty,
    trade_currency: isArs ? 'ARS' : 'MEP',
    trade_quantity: count,
    trade_price: tradePrice,
    trade_commission: tradeCommission,
    cedear_ratio: ratio,
    needs_review: notes.length > 0,
    review_note: notes.length ? notes.join(' ') : null,
  }
}

export function planTradeRecordBackfill(
  rows: LedgerRow[],
  fx: FxLookup,
  ratios: ReadonlyMap<string, number>
): { updates: TradeRecordUpdate[]; skipped: { id: string; reason: string }[] } {
  const updates: TradeRecordUpdate[] = []
  const skipped: { id: string; reason: string }[] = []
  for (const r of rows) {
    if (r.asset_type === 'ACCION') updates.push(planAccion(r, fx, ratios))
    else if (r.asset_type === 'ON') updates.push(mirror(r, fx, 'MEP', 'reference', null))
    else if (r.asset_type === 'CEDEAR') {
      if (r.moneda === 'ARS' || r.moneda === 'USD') updates.push(planCedear(r, fx, ratios))
      else skipped.push({ id: r.id, reason: `CEDEAR with moneda ${r.moneda}` })
    } else skipped.push({ id: r.id, reason: `unknown asset_type ${r.asset_type}` })
  }
  return { updates, skipped }
}
